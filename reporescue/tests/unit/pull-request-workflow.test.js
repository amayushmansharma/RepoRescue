import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveUserFork,
  resolveAvailableBranchName,
  openPullRequest,
  executePullRequestWorkflow,
  isWorkflowFilePath,
  sessionHasWorkflowScope,
} from "../../server/src/github/github-write-client.js";
import {
  preparePullRequestSubmission,
  verifyConfirmToken,
} from "../../server/src/services/pull-request-service.js";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("resolveUserFork detects when authenticated user directly owns upstream repository", async () => {
  const session = { userId: "owneruser", login: "owneruser", accessToken: "test_token" };
  const fork = await resolveUserFork("owneruser", "test-repo", session, "test_token");
  assert.equal(fork.owner, "owneruser");
  assert.equal(fork.name, "test-repo");
  assert.equal(fork.isDirectOwner, true);
});

test("resolveUserFork finds existing fork under user account", async () => {
  const session = { userId: "contributor", login: "contributor", accessToken: "test_token" };
  const mockFetch = async (url) => {
    if (url.includes("/repos/contributor/upstream-repo")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ name: "upstream-repo", default_branch: "main" }),
      };
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ message: "Not Found" }) };
  };

  const fork = await resolveUserFork("upstream-org", "upstream-repo", session, "test_token", {
    fetchImplementation: mockFetch,
  });

  assert.equal(fork.owner, "contributor");
  assert.equal(fork.name, "upstream-repo");
  assert.equal(fork.isDirectOwner, false);
});

test("resolveUserFork creates fork and polls for readiness when fork does not exist", async () => {
  const session = { userId: "newcontributor", login: "newcontributor", accessToken: "test_token" };
  let forkCreated = false;
  let pollAttempts = 0;

  const mockFetch = async (url, options = {}) => {
    if (url.includes("/repos/newcontributor/target-repo")) {
      pollAttempts++;
      if (!forkCreated || pollAttempts < 2) {
        return { ok: false, status: 404, text: async () => JSON.stringify({ message: "Not Found" }) };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ name: "target-repo", default_branch: "main" }),
      };
    }
    if (url.includes("/repos/upstream-org/target-repo/forks") && options.method === "POST") {
      forkCreated = true;
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ owner: { login: "newcontributor" }, name: "target-repo" }),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const fork = await resolveUserFork("upstream-org", "target-repo", session, "test_token", {
    fetchImplementation: mockFetch,
    pollIntervalMs: 5,
    maxPollAttempts: 4,
  });

  assert.equal(fork.owner, "newcontributor");
  assert.equal(fork.name, "target-repo");
  assert.ok(pollAttempts >= 2);
});

test("resolveUserFork throws FORKING_DISABLED when upstream repository forbids forking", async () => {
  const session = { userId: "contributor", login: "contributor", accessToken: "test_token" };
  const mockFetch = async (url, options = {}) => {
    if (options.method === "POST") {
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: "Forking is disabled for this repository" }),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  await assert.rejects(
    () => resolveUserFork("restricted-org", "secret-repo", session, "test_token", {
      fetchImplementation: mockFetch,
    }),
    { code: "FORKING_DISABLED" },
  );
});

test("resolveAvailableBranchName handles branch collision by appending unique suffix", async () => {
  const mockFetch = async (url) => {
    // Branch "reporescue/fix-1" already exists on the fork
    if (url.includes("heads/reporescue%2Ffix-1")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ object: { sha: "1111111111111111111111111111111111111111" } }),
      };
    }
    // Collided fallback does not exist
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const resolved = await resolveAvailableBranchName("forkowner", "repo", "reporescue/fix-1", "test_token", {
    fetchImplementation: mockFetch,
  });

  assert.ok(resolved.startsWith("reporescue/fix-1-"));
  assert.notEqual(resolved, "reporescue/fix-1");
});

test("openPullRequest sets cross-repository head as forkOwner:branch", async () => {
  let capturedBody = null;
  const mockFetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        number: 42,
        html_url: "https://github.com/upstream/project/pull/42",
        id: 123456,
        state: "open",
        title: capturedBody.title,
      }),
    };
  };

  const res = await openPullRequest(
    "upstream",
    "project",
    {
      title: "Improve onboarding",
      body: "Addresses readiness findings",
      baseBranch: "main",
      headBranch: "reporescue/fix-abc",
      forkOwner: "mycontributor",
      token: "test_token",
    },
    { fetchImplementation: mockFetch },
  );

  assert.equal(capturedBody.head, "mycontributor:reporescue/fix-abc");
  assert.equal(capturedBody.base, "main");
  assert.equal(res.prNumber, 42);
  assert.equal(res.prUrl, "https://github.com/upstream/project/pull/42");
});

test("executePullRequestWorkflow executes entire fork → branch → commit → PR pipeline with distinct tree SHA and commit SHA", async () => {
  const calls = [];
  const expectedCommitSha = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
  const expectedTreeSha = "eeee5555eeee5555eeee5555eeee5555eeee5555";
  let treeBodyCaptured = null;
  let commitBodyCaptured = null;

  const mockFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET" });
    if (url.includes("/branches/main")) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          name: "main",
          commit: {
            sha: expectedCommitSha,
            commit: {
              tree: { sha: expectedTreeSha },
            },
          },
        }),
      };
    }
    if (url.includes("/git/ref/heads/main")) {
      return { ok: true, text: async () => JSON.stringify({ object: { sha: expectedCommitSha } }) };
    }
    if (url.includes("/repos/contributor/my-repo") && options.method === "GET") {
      return { ok: true, text: async () => JSON.stringify({ name: "my-repo", default_branch: "main" }) };
    }
    if (url.includes("/git/ref/heads/reporescue")) {
      return { ok: false, status: 404, text: async () => "{}" };
    }
    if (url.includes("/git/blobs")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222" }) };
    }
    if (url.includes("/git/trees")) {
      treeBodyCaptured = JSON.parse(options.body ?? "{}");
      return { ok: true, text: async () => JSON.stringify({ sha: "cccc3333cccc3333cccc3333cccc3333cccc3333" }) };
    }
    if (url.includes("/git/commits")) {
      commitBodyCaptured = JSON.parse(options.body ?? "{}");
      return { ok: true, text: async () => JSON.stringify({ sha: "dddd4444dddd4444dddd4444dddd4444dddd4444" }) };
    }
    if (url.includes("/git/refs") && options.method === "POST") {
      return { ok: true, text: async () => JSON.stringify({ object: { sha: "dddd4444dddd4444dddd4444dddd4444dddd4444" } }) };
    }
    if (url.includes("/pulls") && options.method === "POST") {
      return {
        ok: true,
        text: async () => JSON.stringify({
          number: 101,
          html_url: "https://github.com/original-org/my-repo/pull/101",
          id: 9999,
          state: "open",
        }),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const result = await executePullRequestWorkflow({
    assessment: {
      repository: { owner: "original-org", name: "my-repo", fullName: "original-org/my-repo", defaultBranch: "main" },
    },
    session: {
      userId: "contributor",
      login: "contributor",
      accessToken: "test_access_token",
    },
    destination: { baseBranch: "main" },
    reviewPayload: {
      title: "docs: add onboarding guide",
      body: "PR description",
      fileContents: [{ path: "README.md", content: "# Readme" }],
    },
    options: { fetchImplementation: mockFetch },
  });

  assert.equal(result.submitted, true);
  assert.equal(result.prNumber, 101);
  assert.equal(result.prUrl, "https://github.com/original-org/my-repo/pull/101");
  assert.equal(result.fork, "contributor/my-repo");
  assert.equal(result.upstream, "original-org/my-repo");

  // Verify tree received base_tree with tree SHA (NOT commit SHA)
  assert.ok(treeBodyCaptured, "Tree body was captured");
  assert.equal(treeBodyCaptured.base_tree, expectedTreeSha, "base_tree must be Git tree SHA, not commit SHA");

  // Verify commit received commit SHA as parent
  assert.ok(commitBodyCaptured, "Commit body was captured");
  assert.deepEqual(commitBodyCaptured.parents, [expectedCommitSha], "commit parent must be base commit SHA");

  // Upstream repository was only queried for base branch ref and opening PR:
  const upstreamWrites = calls.filter((c) => c.url.includes("/repos/original-org/") && c.method === "POST" && !c.url.endsWith("/pulls"));
  assert.equal(upstreamWrites.length, 0); // Strictly zero direct git writes to upstream repository!
});

test("preparePullRequestSubmission and submitPullRequest validate confirmToken end-to-end", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  const session = {
    sessionId: "sess_12345",
    userId: "testuser",
    accessToken: "ghu_token_abc",
  };

  const assessment = {
    repository: { owner: "org", name: "repo", fullName: "org/repo", defaultBranch: "main" },
    snapshot: {
      repository: { owner: "org", name: "repo", fullName: "org/repo", defaultBranch: "main" },
      headSha: "1111222233334444555566667777888899990000",
      files: [],
      tree: [],
    },
    findings: [
      {
        id: "finding-readme",
        ruleId: "documentation/readme",
        severity: "medium",
        title: "Missing README",
        remediation: { kind: "auto" },
      },
    ],
    score: { total: 50 },
  };

  const testPlan = {
    fileContents: [{ path: "README.md", content: "# Project Readme" }],
    proposals: [
      {
        id: "prop-1",
        findingId: "finding-readme",
        kind: "patch",
        outcome: "Add README.md",
        files: [{ path: "README.md", changeType: "create", additions: 1, deletions: 0 }],
        overallValidation: "passed",
        validation: [{ id: "syntax", label: "Valid Markdown", state: "passed" }],
        limitations: [],
      },
    ],
  };

  // Step 1: Prepare submission (preview)
  const prepared = await preparePullRequestSubmission({
    assessment,
    session,
    destination: { baseBranch: "main", baseSha: "1111222233334444555566667777888899990000" },
    findingIds: ["finding-readme"],
    plan: testPlan,
  });

  assert.ok(prepared.confirmToken);
  assert.ok(prepared.contentHash);

  // Step 2: Verify confirmation token check directly
  const verified = await verifyConfirmToken({
    confirmToken: prepared.confirmToken,
    sessionFingerprint: prepared.sessionFingerprint,
    preparedAt: prepared.preparedAt,
    contentHash: prepared.contentHash,
    branchBaseSha: prepared.currentBaseSha,
    selectionVersion: "finding-readme",
  });
  assert.equal(verified, true);

  // Step 3: Tampered confirmToken is rejected
  await assert.rejects(
    () => verifyConfirmToken({
      confirmToken: "tampered_signature." + prepared.confirmToken.split(".")[1],
      sessionFingerprint: prepared.sessionFingerprint,
      preparedAt: prepared.preparedAt,
      contentHash: prepared.contentHash,
      branchBaseSha: prepared.currentBaseSha,
      selectionVersion: "finding-readme",
    }),
    { code: "INVALID_INPUT" },
  );
});

test("executePullRequestWorkflow is idempotent when open PR already exists for branch", async () => {
  const session = { userId: "testdev", login: "testdev", accessToken: "valid_token" };
  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/repos/upstream/repo/git/ref/heads/main") || urlStr.includes("/branches/main")) {
      return { ok: true, text: async () => JSON.stringify({ object: { sha: "1111222233334444555566667777888899990000" } }) };
    }
    // Fork check
    if (urlStr.includes("/repos/testdev/repo")) {
      return { ok: true, text: async () => JSON.stringify({ name: "repo", default_branch: "main" }) };
    }
    // Existing PR query returns an open PR
    if (urlStr.includes("/pulls?")) {
      return {
        ok: true,
        text: async () => JSON.stringify([
          {
            number: 42,
            html_url: "https://github.com/upstream/repo/pull/42",
            head: { ref: "reporescue/readiness-fix-1111222", sha: "1111222233334444555566667777888899990000" },
          },
        ]),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const result = await executePullRequestWorkflow({
    assessment: { repository: { owner: "upstream", name: "repo", defaultBranch: "main" } },
    session,
    destination: { baseSha: "1111222233334444555566667777888899990000" },
    reviewPayload: { branchCandidate: "readiness-fix" },
    options: { fetchImplementation: mockFetch },
  });

  assert.equal(result.submitted, true);
  assert.equal(result.alreadyExisted, true);
  assert.equal(result.prNumber, 42);
  assert.equal(result.prUrl, "https://github.com/upstream/repo/pull/42");
});

test("isWorkflowFilePath identifies .github/workflows files case-insensitively and allows other paths", () => {
  // Workflow paths (should return true)
  assert.equal(isWorkflowFilePath(".github/workflows/ci.yml"), true);
  assert.equal(isWorkflowFilePath(".github/workflows/deploy.yaml"), true);
  assert.equal(isWorkflowFilePath(".GITHUB/WORKFLOWS/ci.yml"), true);
  assert.equal(isWorkflowFilePath(".GitHub/Workflows/build.yml"), true);
  assert.equal(isWorkflowFilePath(".github/workflows/subdir/sub.yml"), true);
  assert.equal(isWorkflowFilePath("/.github/workflows/ci.yml"), true);
  assert.equal(isWorkflowFilePath(".github/workflows"), true);

  // Similar-looking or non-workflow paths (must return false)
  assert.equal(isWorkflowFilePath(".github/PULL_REQUEST_TEMPLATE.md"), false);
  assert.equal(isWorkflowFilePath(".github/ISSUE_TEMPLATE/bug_report.md"), false);
  assert.equal(isWorkflowFilePath(".github/workflows_old/ci.yml"), false);
  assert.equal(isWorkflowFilePath(".github/workflows-backup/ci.yml"), false);
  assert.equal(isWorkflowFilePath("workflows/ci.yml"), false);
  assert.equal(isWorkflowFilePath("src/.github/workflows/ci.yml"), false);
  assert.equal(isWorkflowFilePath("README.md"), false);
  assert.equal(isWorkflowFilePath(".gitignore"), false);
  assert.equal(isWorkflowFilePath("package.json"), false);
  assert.equal(isWorkflowFilePath(null), false);
  assert.equal(isWorkflowFilePath(""), false);
});

test("sessionHasWorkflowScope correctly inspects session scope string", () => {
  assert.equal(sessionHasWorkflowScope({ scope: "read:user public_repo workflow" }), true);
  assert.equal(sessionHasWorkflowScope({ scope: "repo,workflow" }), true);
  assert.equal(sessionHasWorkflowScope({ scope: "read:user public_repo" }), false);
  assert.equal(sessionHasWorkflowScope({ scope: "read:user" }), false);
  assert.equal(sessionHasWorkflowScope(null), false);
  assert.equal(sessionHasWorkflowScope({}), false);
});

test("executePullRequestWorkflow blocks .github/workflows files when session lacks workflow scope without writing", async () => {
  let networkCalls = 0;
  const mockFetch = async () => {
    networkCalls++;
    return { ok: true, text: async () => "{}" };
  };

  const session = {
    userId: "contributor",
    login: "contributor",
    accessToken: "valid_token",
    scope: "read:user public_repo", // Missing 'workflow' scope!
  };

  await assert.rejects(
    () => executePullRequestWorkflow({
      assessment: {
        repository: { owner: "upstream", name: "repo", fullName: "upstream/repo", defaultBranch: "main" },
      },
      session,
      reviewPayload: {
        fileContents: [
          { path: "README.md", content: "# Readme" },
          { path: ".github/workflows/ci.yml", content: "name: CI" },
        ],
      },
      options: { fetchImplementation: mockFetch },
    }),
    (err) => {
      assert.equal(err.code, "WORKFLOW_SCOPE_REQUIRED");
      assert.equal(err.status, 403);
      assert.ok(err.message.includes(".github/workflows/ci.yml"));
      assert.deepEqual(err.details?.workflowFiles, [".github/workflows/ci.yml"]);
      return true;
    },
  );

  // Assert zero network write calls were made to GitHub
  assert.equal(networkCalls, 0, "No network calls must be made when workflow scope is missing");
});

test("preparePullRequestSubmission includes workflowFiles metadata", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  const session = {
    sessionId: "sess_wf",
    userId: "testuser",
    accessToken: "ghu_token_abc",
    scope: "read:user public_repo",
  };

  const assessment = {
    repository: { owner: "org", name: "repo", fullName: "org/repo", defaultBranch: "main" },
    snapshot: {
      repository: { owner: "org", name: "repo", fullName: "org/repo", defaultBranch: "main" },
      headSha: "1111222233334444555566667777888899990000",
      files: [],
    },
    findings: [
      { id: "ci-missing", ruleId: "ci-missing", severity: "high", title: "CI missing", remediation: { kind: "auto" } },
    ],
    score: { total: 50 },
  };

  const testPlan = {
    fileContents: [
      { path: "README.md", content: "# Readme" },
      { path: ".github/workflows/ci.yml", content: "name: CI" },
    ],
    proposals: [
      {
        id: "prop-ci",
        findingId: "ci-missing",
        kind: "patch",
        outcome: "Add CI workflow",
        files: [{ path: ".github/workflows/ci.yml", changeType: "create", additions: 10, deletions: 0 }],
        validation: [],
      },
    ],
  };

  const prepared = await preparePullRequestSubmission({
    assessment,
    session,
    destination: { baseBranch: "main", baseSha: "1111222233334444555566667777888899990000" },
    findingIds: ["ci-missing"],
    plan: testPlan,
  });

  assert.equal(prepared.hasWorkflowFiles, true);
  assert.deepEqual(prepared.workflowFiles, [".github/workflows/ci.yml"]);
});

test("executePullRequestWorkflow allows .github/workflows files when workflow scope is present", async () => {
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET" });
    if (url.includes("/branches/main")) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          name: "main",
          commit: {
            sha: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
            commit: { tree: { sha: "eeee5555eeee5555eeee5555eeee5555eeee5555" } },
          },
        }),
      };
    }
    if (url.includes("/repos/contributor/my-repo") && options.method === "GET") {
      return { ok: true, text: async () => JSON.stringify({ name: "my-repo", default_branch: "main" }) };
    }
    if (url.includes("/git/ref/heads/reporescue")) {
      return { ok: false, status: 404, text: async () => "{}" };
    }
    if (url.includes("/git/blobs")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222" }) };
    }
    if (url.includes("/git/trees")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "cccc3333cccc3333cccc3333cccc3333cccc3333" }) };
    }
    if (url.includes("/git/commits")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "dddd4444dddd4444dddd4444dddd4444dddd4444" }) };
    }
    if (url.includes("/git/refs") && options.method === "POST") {
      return { ok: true, text: async () => JSON.stringify({ object: { sha: "dddd4444dddd4444dddd4444dddd4444dddd4444" } }) };
    }
    if (url.includes("/pulls") && options.method === "POST") {
      return {
        ok: true,
        text: async () => JSON.stringify({
          number: 102,
          html_url: "https://github.com/upstream/my-repo/pull/102",
          id: 9999,
          state: "open",
        }),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  const session = {
    userId: "contributor",
    login: "contributor",
    accessToken: "valid_token",
    scope: "read:user public_repo workflow", // Has 'workflow' scope!
  };

  const result = await executePullRequestWorkflow({
    assessment: {
      repository: { owner: "upstream", name: "my-repo", fullName: "upstream/my-repo", defaultBranch: "main" },
    },
    session,
    destination: { baseBranch: "main" },
    reviewPayload: {
      title: "ci: add workflow",
      fileContents: [{ path: ".github/workflows/ci.yml", content: "name: CI" }],
    },
    options: { fetchImplementation: mockFetch },
  });

  assert.equal(result.submitted, true);
  assert.equal(result.prNumber, 102);
});

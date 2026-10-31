import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../../server/src/app.js";
import { _createTestSession } from "../../server/src/auth/auth-service.js";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let server;
let base;
let testScanId;
let autoFindingIds = [];

const postJson = async (path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res;
};

before(async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "test";

  const app = createApp({ clientOrigin: "http://localhost:5173" });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  // Create a demo scan using the standard API
  const scanRes = await postJson("/api/scans", { mode: "demo", demoId: "beacon-api" });
  const scanData = await scanRes.json();
  testScanId = scanData.data.scan.scanId;
  autoFindingIds = scanData.data.scan.findings
    .filter((f) => f.remediation.kind === "auto")
    .map((f) => f.id);
});

after(() => new Promise((resolve) => server.close(resolve)));

test("POST /api/pull-requests rejects unauthenticated requests with 401", async () => {
  const res = await postJson("/api/pull-requests", {
    scanId: testScanId,
    findingIds: autoFindingIds,
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, "AUTHENTICATION_REQUIRED");
});

test("POST /api/pull-requests rejects requests without confirmToken with 400", async () => {
  const session = _createTestSession({
    login: "testdev",
    accessToken: "test_token_123",
  });

  const res = await postJson(
    "/api/pull-requests",
    { scanId: testScanId, findingIds: autoFindingIds },
    { Cookie: session.cookieHeader },
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error.code, "INVALID_INPUT");
});

test("POST /api/pull-requests/preview provides submission metadata when session is present", async () => {
  const session = _createTestSession({
    login: "testdev",
    accessToken: "test_token_123",
  });

  const res = await postJson(
    "/api/pull-requests/preview",
    { scanId: testScanId, findingIds: autoFindingIds },
    { Cookie: session.cookieHeader },
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.data.draft);
  assert.ok(data.data.submission);
  assert.ok(data.data.submission.confirmToken);
  assert.ok(data.data.submission.contentHash);
  assert.ok(data.data.submission.baseSha);
});

test("POST /api/pull-requests submits PR successfully with valid confirmToken for non-workflow findings", async () => {
  const session = _createTestSession({
    login: "mockuser",
    accessToken: "ghu_valid_mock_token",
    scope: "read:user,public_repo",
  });

  const nonWorkflowFindingIds = autoFindingIds.filter((id) => id !== "ci-missing");

  // Step 1: Preview to get signed confirmToken
  const previewRes = await postJson(
    "/api/pull-requests/preview",
    { scanId: testScanId, findingIds: nonWorkflowFindingIds },
    { Cookie: session.cookieHeader },
  );
  const previewData = await previewRes.json();
  const sub = previewData.data.submission;

  // Intercept global fetch for GitHub API during submission
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    if (!urlStr.includes("api.github.com")) {
      return originalFetch(url, init);
    }
    // Upstream ref check
    if (urlStr.includes("/git/ref/heads/main") || urlStr.includes("/branches/main")) {
      return { ok: true, text: async () => JSON.stringify({ object: { sha: sub.baseSha } }) };
    }
    // Fork check
    if (urlStr.includes("/repos/mockuser/beacon-api") && init.method !== "POST") {
      return { ok: true, text: async () => JSON.stringify({ name: "beacon-api", default_branch: "main" }) };
    }
    // Branch ref check
    if (urlStr.includes("/git/ref/heads/reporescue")) {
      return { ok: false, status: 404, text: async () => "{}" };
    }
    // Git blobs
    if (urlStr.includes("/git/blobs")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "bbbb111122223333444455556666777788889999" }) };
    }
    // Git trees
    if (urlStr.includes("/git/trees")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "cccc111122223333444455556666777788889999" }) };
    }
    // Git commits
    if (urlStr.includes("/git/commits")) {
      return { ok: true, text: async () => JSON.stringify({ sha: "caaa111122223333444455556666777788889999" }) };
    }
    // Git refs
    if (urlStr.includes("/git/refs")) {
      return { ok: true, text: async () => JSON.stringify({ object: { sha: "caaa111122223333444455556666777788889999" } }) };
    }
    // Pulls
    if (urlStr.includes("/pulls") && init.method === "POST") {
      return {
        ok: true,
        text: async () => JSON.stringify({
          number: 77,
          html_url: "https://github.com/beacon/beacon-api/pull/77",
          id: 5555,
          state: "open",
        }),
      };
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };

  try {
    const res = await postJson(
      "/api/pull-requests",
      {
        scanId: testScanId,
        findingIds: nonWorkflowFindingIds,
        confirmToken: sub.confirmToken,
        preparedAt: sub.preparedAt,
        contentHash: sub.contentHash,
        baseSha: sub.baseSha,
        baseBranch: sub.baseBranch,
        title: "docs: add readiness fixes",
        body: "Description",
      },
      { Cookie: session.cookieHeader },
    );

    assert.equal(res.status, 201);
    const result = await res.json();
    assert.equal(result.ok, true);
    assert.equal(result.data.submitted, true);
    assert.equal(result.data.prNumber, 77);
    assert.equal(result.data.prUrl, "https://github.com/beacon/beacon-api/pull/77");
    assert.equal(result.data.fork, "mockuser/beacon-api");

    // Verify submission audit log is retrievable via GET /api/pull-requests/:scanId
    const auditRes = await fetch(`${base}/api/pull-requests/${testScanId}`);
    assert.equal(auditRes.status, 200);
    const auditData = await auditRes.json();
    assert.equal(auditData.ok, true);
    assert.ok(auditData.data.pullRequests.length >= 1);
    assert.equal(auditData.data.pullRequests[0].prNumber, 77);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/pull-requests returns 403 WORKFLOW_SCOPE_REQUIRED when workflow files are submitted without workflow scope", async () => {
  const session = _createTestSession({
    login: "mockuser",
    accessToken: "ghu_valid_mock_token",
    scope: "read:user,public_repo", // Lacks 'workflow'
  });

  const previewRes = await postJson(
    "/api/pull-requests/preview",
    { scanId: testScanId, findingIds: autoFindingIds },
    { Cookie: session.cookieHeader },
  );
  const previewData = await previewRes.json();
  const sub = previewData.data.submission;

  const res = await postJson(
    "/api/pull-requests",
    {
      scanId: testScanId,
      findingIds: autoFindingIds,
      confirmToken: sub.confirmToken,
      preparedAt: sub.preparedAt,
      contentHash: sub.contentHash,
      baseSha: sub.baseSha,
      baseBranch: sub.baseBranch,
      title: "docs: add readiness fixes",
      body: "Description",
    },
    { Cookie: session.cookieHeader },
  );

  assert.equal(res.status, 403);
  const errorData = await res.json();
  assert.equal(errorData.ok, false);
  assert.equal(errorData.error.code, "WORKFLOW_SCOPE_REQUIRED");
  assert.ok(errorData.error.details?.workflowFiles?.length > 0);
});

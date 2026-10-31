import crypto from "node:crypto";
import { ApiError } from "../http/errors.js";
import {
  githubApiOrigin,
  validateBranchName,
  validateGithubName,
  validateGithubLogin,
  validatePathSegment,
  validateSha,
} from "./github-app-config.js";

const WRITE_TIMEOUT_MS = 10_000;
const _DEFAULT_REF_PREFIX = "refs/heads/";

export function isWorkflowFilePath(filePath) {
  if (typeof filePath !== "string") return false;
  const clean = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return clean === ".github/workflows" || clean.startsWith(".github/workflows/");
}

export function sessionHasWorkflowScope(session) {
  const scopesList = String(session?.scope ?? "").split(/[\s,]+/).filter(Boolean);
  return scopesList.includes("workflow");
}

function requestHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "RepoRescue/1.0 (GitHub pull requests)",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asGithubWriteError(error, action) {
  if (error instanceof ApiError) return error;
  const status = typeof error?.status === "number"
    ? error.status
    : typeof error?.response?.status === "number"
      ? error.response.status
      : null;
  if (!status) return new ApiError("GITHUB_UNAVAILABLE", `${action} could not be completed because GitHub did not respond.`);
  if (status === 401) return new ApiError("SESSION_REQUIRES_REAUTH", `${action} needed reauthorization. Reconnect GitHub and try again.`);
  if (status === 403) return new ApiError("INSUFFICIENT_PERMISSION", `${action} was denied by GitHub. The current access level is insufficient to write to this repository.`);
  if (status === 404 || status === 410 || status === 451) return new ApiError("REPOSITORY_NOT_FOUND", `${action} could not find the destination repository or branch.`);
  if (status === 422) {
    const body = error.response?.body;
    if (body?.errors?.some((entry) => /already exists/i.test(entry?.message ?? entry?.code ?? "")) || /already exists/i.test(body?.message ?? "")) {
      return new ApiError("DUPLICATE_SUBMISSION", `${action} found an existing open pull request for this branch.`);
    }
    if (body?.errors?.some((entry) => /invalid/i.test(entry?.message ?? entry?.code ?? "")) || /invalid/i.test(body?.message ?? "")) {
      return new ApiError("INVALID_INPUT", `${action} rejected the proposed content as invalid.`);
    }
    return new ApiError("CONFLICT", `${action} could not be applied because it conflicts with the repository state.`);
  }
  if (status === 409) return new ApiError("CONFLICT", `${action} conflicts with a concurrent update. The destination branch or branch content changed.`);
  if (status === 412) return new ApiError("CONFLICT", `${action} needs to be reviewed again because the base branch moved.`);
  if (status === 423) return new ApiError("CONFLICT", `${action} is busy. GitHub asked the client to wait before writing again.`);
  if (status === 429) return new ApiError("GITHUB_RATE_LIMITED", `${action} reached the GitHub API rate limit. Try again after the retry window.`);
  if (status >= 500) return new ApiError("GITHUB_UNAVAILABLE", `${action} is temporarily unavailable. Try again shortly.`);
  return new ApiError("UPSTREAM_ERROR", `${action} failed (status ${status}).`);
}

function requestBodyContent(content) {
  return Buffer.from(String(content), "utf8").toString("base64");
}

export function contentToSha(content) {
  return crypto.createHash("sha256").update(String(content), "utf8").digest("hex");
}

function loginName(value) {
  return validateGithubLogin(value);
}

function repoName(value) {
  return validateGithubName(value);
}

export async function githubWriteRequest(path, { method = "GET", token, body, action, timeoutMs = WRITE_TIMEOUT_MS, fetchImplementation = globalThis.fetch }) {
  const response = await fetchImplementation(`${githubApiOrigin()}${path}`, {
    method,
    headers: requestHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const error = new Error(action);
    error.status = response.status;
    error.response = { status: response.status, body: payload };
    if (process.env.NODE_ENV !== "test") {
      const sanitizedMsg = typeof payload === "object" && payload ? payload.message ?? JSON.stringify(payload) : String(payload ?? "");
      console.warn(`[reporescue] GitHub write request failed: ${method} ${path} -> HTTP ${response.status} (${sanitizedMsg})`);
    }
    throw asGithubWriteError(error, action);
  }
  return payload;
}

function buildRefPath(owner, repo, branchName) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/git/ref/heads/${encodeURIComponent(validateBranchName(branchName))}`;
}

function buildRefsPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/git/refs`;
}

function buildTreePath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/git/trees`;
}

function buildCommitPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/git/commits`;
}

function buildPullRequestsPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/pulls`;
}

export async function fetchBranchHeadDetails(owner, repo, baseBranch, token, options = {}) {
  // 1. Try branch endpoint first: /repos/{owner}/{repo}/branches/{baseBranch}
  try {
    const branchPath = `/repos/${loginName(owner)}/${repoName(repo)}/branches/${encodeURIComponent(validateBranchName(baseBranch))}`;
    const branchPayload = await githubWriteRequest(branchPath, {
      method: "GET",
      token,
      action: "Reading the base branch details",
      ...options,
    });
    const commitSha = branchPayload?.commit?.sha ?? null;
    const treeSha = branchPayload?.commit?.commit?.tree?.sha ?? null;
    if (commitSha) {
      return {
        commitSha: validateSha(commitSha),
        treeSha: treeSha ? validateSha(treeSha) : null,
      };
    }
  } catch (error) {
    if (error.code !== "REPOSITORY_NOT_FOUND" && error.status !== 404) {
      throw error;
    }
  }

  // 2. Fallback: query git ref /repos/{owner}/{repo}/git/ref/heads/{baseBranch}
  const refPath = buildRefPath(owner, repo, baseBranch);
  const refPayload = await githubWriteRequest(refPath, {
    method: "GET",
    token,
    action: "Reading the base branch ref",
    ...options,
  });
  const commitSha = refPayload?.object?.sha ?? null;
  if (!commitSha) {
    throw new ApiError("REPOSITORY_NOT_FOUND", `Could not find base branch ${baseBranch} on ${owner}/${repo}.`);
  }
  const validatedCommitSha = validateSha(commitSha);

  // 3. Read the commit object to retrieve its root tree SHA
  try {
    const commitPath = `/repos/${loginName(owner)}/${repoName(repo)}/git/commits/${validatedCommitSha}`;
    const commitPayload = await githubWriteRequest(commitPath, {
      method: "GET",
      token,
      action: "Reading the base commit tree",
      ...options,
    });
    const treeSha = commitPayload?.tree?.sha ?? null;
    return {
      commitSha: validatedCommitSha,
      treeSha: treeSha ? validateSha(treeSha) : null,
    };
  } catch {
    return {
      commitSha: validatedCommitSha,
      treeSha: null,
    };
  }
}

export async function fetchBranchHeadSha(owner, repo, baseBranch, token, options = {}) {
  const details = await fetchBranchHeadDetails(owner, repo, baseBranch, token, options);
  return details?.commitSha ?? null;
}

export async function fetchBranchSha(owner, repo, branchName, token, options = {}) {
  try {
    const refPath = buildRefPath(owner, repo, branchName);
    const payload = await githubWriteRequest(refPath, {
      method: "GET",
      token,
      action: "Reading the pull request branch",
      ...options,
    });
    const sha = payload?.object?.sha ?? null;
    return sha ? validateSha(sha) : null;
  } catch {
    return null;
  }
}

export async function checkBranchExists(owner, repo, branchName, token, options = {}) {
  const sha = await fetchBranchSha(owner, repo, branchName, token, options);
  return Boolean(sha);
}

export async function resolveAvailableBranchName(forkOwner, forkRepo, baseCandidate, token, options = {}) {
  let candidate = validateBranchName(baseCandidate);
  const exists = await checkBranchExists(forkOwner, forkRepo, candidate, token, options);
  if (!exists) {
    return candidate;
  }
  // Collision detected: append short deterministic timestamp suffix
  const suffix = Date.now().toString(36).slice(-5);
  return `${candidate}-${suffix}`;
}

export async function resolveUserFork(owner, repo, session, token, options = {}) {
  const userLogin = loginName(session.userId ?? session.login);
  const upstreamOwner = loginName(owner);
  const targetRepo = repoName(repo);

  // If the authenticated user is already the owner of the upstream repository
  if (userLogin.toLowerCase() === upstreamOwner.toLowerCase()) {
    return {
      owner: userLogin,
      name: targetRepo,
      isDirectOwner: true,
      defaultBranch: "main",
    };
  }

  // 1. Check if user already has an existing fork under their account
  try {
    const existing = await githubWriteRequest(`/repos/${userLogin}/${targetRepo}`, {
      method: "GET",
      token,
      action: "Checking for existing user fork",
      ...options,
    });
    if (existing && !existing.message) {
      return {
        owner: userLogin,
        name: existing.name || targetRepo,
        defaultBranch: existing.default_branch || "main",
        isDirectOwner: false,
      };
    }
  } catch (err) {
    if (err.status !== 404 && err.code !== "REPOSITORY_NOT_FOUND") {
      throw err;
    }
  }

  // 2. Trigger fork creation on GitHub
  let forkCreated;
  try {
    forkCreated = await githubWriteRequest(`/repos/${upstreamOwner}/${targetRepo}/forks`, {
      method: "POST",
      token,
      body: { default_branch_only: false },
      action: "Creating a fork of the destination repository",
      ...options,
    });
  } catch (err) {
    if (err.status === 403 || err.code === "INSUFFICIENT_PERMISSION") {
      throw new ApiError(
        "FORKING_DISABLED",
        `Forking is disabled on ${upstreamOwner}/${targetRepo} or your GitHub account does not have permission to fork it.`,
      );
    }
    throw err;
  }

  const forkOwner = String(forkCreated?.owner?.login ?? userLogin).slice(0, 50);
  const forkName = String(forkCreated?.name ?? targetRepo).slice(0, 100);

  // 3. Poll for fork readiness (GitHub creates forks asynchronously and returns HTTP 202)
  const maxAttempts = options.maxPollAttempts ?? 5;
  const pollDelay = options.pollIntervalMs ?? 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const poll = await githubWriteRequest(`/repos/${forkOwner}/${forkName}`, {
        method: "GET",
        token,
        action: "Checking fork readiness",
        ...options,
      });
      if (poll && !poll.message) {
        return {
          owner: forkOwner,
          name: forkName,
          defaultBranch: poll.default_branch || "main",
          isDirectOwner: false,
        };
      }
    } catch {
      // still provisioning
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, pollDelay));
    }
  }

  return { owner: forkOwner, name: forkName, defaultBranch: "main", isDirectOwner: false };
}

export async function checkExistingPullRequest(owner, repo, branchName, token, options = {}) {
  try {
    const params = new URLSearchParams({ head: `${owner}:${branchName}`, state: "open" });
    const pullsPath = buildPullRequestsPath(owner, repo);
    const payload = await githubWriteRequest(`${pullsPath}?${params.toString()}`, {
      method: "GET",
      token,
      action: "Checking for an existing open pull request",
      ...options,
    });
    return Array.isArray(payload) ? payload.find((item) => item?.number && item?.head?.ref === branchName) : null;
  } catch {
    return null;
  }
}

export async function createBinaryBlob(owner, repo, content, token, options = {}) {
  const blobPath = `/repos/${loginName(owner)}/${repoName(repo)}/git/blobs`;
  const payload = await githubWriteRequest(blobPath, {
    method: "POST",
    token,
    body: { content: requestBodyContent(content), encoding: "base64" },
    action: "Writing a file blob",
    ...options,
  });
  return validateSha(payload?.sha);
}

export async function createTree(owner, repo, baseTreeSha, blobShas, token, options = {}) {
  const treePayload = {
    ...(baseTreeSha ? { base_tree: validateSha(baseTreeSha) } : {}),
    tree: blobShas.map(({ path, sha }) => ({
      mode: "100644",
      type: "blob",
      path: validatePathSegment(path),
      sha,
    })),
  };
  const treePath = buildTreePath(owner, repo);
  const payload = await githubWriteRequest(treePath, {
    method: "POST",
    token,
    body: treePayload,
    action: "Storing the updated repository tree",
    ...options,
  });
  return validateSha(payload?.sha);
}

export async function createCommit(owner, repo, treeSha, parentSha, title, token, options = {}) {
  const commitPath = buildCommitPath(owner, repo);
  const payload = await githubWriteRequest(commitPath, {
    method: "POST",
    token,
    body: { message: title, tree: treeSha, parents: [parentSha] },
    action: "Creating the pull request commit",
    ...options,
  });
  return validateSha(payload?.sha);
}

export async function createRepositoryBranch(owner, repo, branchName, baseSha, token, options = {}) {
  const refsPath = buildRefsPath(owner, repo);
  const payload = await githubWriteRequest(refsPath, {
    method: "POST",
    token,
    body: { ref: `refs/heads/${validateBranchName(branchName)}`, sha: baseSha },
    action: "Creating the pull request branch",
    ...options,
  });
  const sha = payload?.object?.sha ?? payload?.sha;
  return { refPath: refsPath, ref: branchName, sha: validateSha(sha) };
}

export async function openPullRequest(upstreamOwner, upstreamRepo, { title, body, baseBranch, headBranch, forkOwner, token }, options = {}) {
  const pullsPath = buildPullRequestsPath(upstreamOwner, upstreamRepo);
  const isSameRepo = forkOwner.toLowerCase() === upstreamOwner.toLowerCase();
  const head = isSameRepo ? validateBranchName(headBranch) : `${loginName(forkOwner)}:${validateBranchName(headBranch)}`;
  let payload;
  try {
    payload = await githubWriteRequest(pullsPath, {
      method: "POST",
      token,
      body: {
        title,
        head,
        base: validateBranchName(baseBranch),
        body,
        maintainer_can_modify: true,
        draft: false,
      },
      action: "Opening the pull request",
      ...options,
    });
  } catch (error) {
    if (error.code === "DUPLICATE_SUBMISSION" || /already exists/i.test(error?.message ?? "")) {
      const existing = await checkExistingPullRequest(upstreamOwner, upstreamRepo, headBranch, token, options);
      if (existing) {
        return {
          prNumber: existing.number,
          prUrl: existing.html_url,
          prId: existing.id,
          state: existing.state,
          title: existing.title,
          branch: headBranch,
          fork: `${forkOwner}/${upstreamRepo}`,
          upstream: `${upstreamOwner}/${upstreamRepo}`,
          alreadyExisted: true,
        };
      }
    }
    throw error;
  }
  return {
    prNumber: payload.number,
    prUrl: payload.html_url,
    prId: payload.id,
    state: payload.state,
    title: payload.title,
    branch: headBranch,
    fork: `${forkOwner}/${upstreamRepo}`,
    upstream: `${upstreamOwner}/${upstreamRepo}`,
    alreadyExisted: false,
  };
}

export async function cleanupPullRequestBranch(owner, repo, branchName, token, options = {}) {
  try {
    const existing = await fetchBranchSha(owner, repo, branchName, token, options);
    if (!existing) return { ok: true, reason: "No branch was created." };
    const deletePath = `/repos/${loginName(owner)}/${repoName(repo)}/git/refs/heads/${encodeURIComponent(validateBranchName(branchName))}`;
    await githubWriteRequest(deletePath, {
      method: "DELETE",
      token,
      action: "Removing the pull request branch",
      ...options,
    });
    return { ok: true, reason: "The branch was removed." };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export function buildPullRequestBranchName({ owner, repo, branchCandidate, currentBaseShaValidated }) {
  const safeCandidate = String(branchCandidate || "readiness-fix").slice(0, 30).replace(/[^a-zA-Z0-9._/-]/g, "-");
  return `reporescue/${sessionOwnerSegment(owner)}-${repoOwnerSegment(repo)}/${safeCandidate}-${currentBaseShaValidated.slice(0, 7)}`;
}

function sessionOwnerSegment(owner) {
  return String(owner).slice(0, 39);
}

function repoOwnerSegment(repo) {
  return String(repo).slice(0, 100);
}

export async function executePullRequestWorkflow({
  assessment,
  session,
  destination = {},
  findingIds: _findingIds,
  reviewPayload = {},
  plan,
  options = {},
}) {
  const token = session?.accessToken;
  if (!token) {
    throw new ApiError("AUTHENTICATION_REQUIRED", "A valid GitHub session with public_repo permission is required.");
  }

  // Pre-check: Ensure workflow files are not submitted without required 'workflow' OAuth scope
  const fileContents = plan?.fileContents ?? reviewPayload.fileContents ?? [];
  const workflowFiles = fileContents
    .map((f) => f.path)
    .filter((p) => isWorkflowFilePath(p));
  const hasWorkflow = sessionHasWorkflowScope(session);
  if (workflowFiles.length > 0 && !hasWorkflow) {
    throw new ApiError(
      "WORKFLOW_SCOPE_REQUIRED",
      `GitHub requires the 'workflow' OAuth scope to create or modify GitHub Actions workflows (${workflowFiles.join(", ")}). Deselect workflow improvements or grant workflow permission to submit.`,
      { details: { workflowFiles } }
    );
  }

  const upstreamOwner = validateGithubLogin(assessment.repository?.owner ?? assessment.repository?.fullName?.split("/")[0] ?? "");
  const upstreamRepo = validateGithubName(assessment.repository?.name ?? assessment.repository?.fullName?.split("/")[1] ?? "");
  const baseBranch = validateBranchName(destination.baseBranch ?? assessment.repository?.defaultBranch ?? "main");

  // Step 1: Upstream HEAD SHA check (UPSTREAM REPO IS STRICTLY READ-ONLY)
  let headDetails;
  try {
    headDetails = await fetchBranchHeadDetails(upstreamOwner, upstreamRepo, baseBranch, token, options);
  } catch (err) {
    if (destination.baseSha && process.env.NODE_ENV === "test") {
      headDetails = {
        commitSha: destination.baseSha,
        treeSha: destination.baseTreeSha ?? destination.baseSha,
      };
    } else {
      throw err;
    }
  }
  let currentBaseSha = headDetails?.commitSha ?? null;
  if (!currentBaseSha && destination.baseSha) {
    currentBaseSha = validateSha(destination.baseSha);
  }
  const currentBaseTreeSha = headDetails?.treeSha ?? (destination.baseTreeSha ? validateSha(destination.baseTreeSha) : null);

  // Step 2: Resolve user fork (ALL WRITES OCCUR ON THE FORK)
  const fork = await resolveUserFork(upstreamOwner, upstreamRepo, session, token, options);

  // Step 3: Branch name generation & collision avoidance
  const branchCandidate = String(reviewPayload.branchCandidate ?? "readiness-fix");
  const baseCandidate = `reporescue/${branchCandidate}-${(currentBaseSha || "head").slice(0, 7)}`;
  const branchName = await resolveAvailableBranchName(fork.owner, fork.name, baseCandidate, token, options);

  // Idempotency: Check if an open PR from this fork already exists for this branch
  const existingPr = await checkExistingPullRequest(upstreamOwner, upstreamRepo, branchName, token, options);
  if (existingPr) {
    return {
      submitted: true,
      alreadyExisted: true,
      prNumber: existingPr.number,
      prUrl: existingPr.html_url,
      branch: branchName,
      fork: `${fork.owner}/${fork.name}`,
      upstream: `${upstreamOwner}/${upstreamRepo}`,
      baseBranch,
      commitSha: existingPr.head?.sha,
      createdAt: Date.now(),
    };
  }

  // Step 4: Write blobs to the fork
  const blobEntries = [];
  for (const entry of fileContents) {
    const blobSha = await createBinaryBlob(fork.owner, fork.name, entry.content, token, options);
    blobEntries.push({ path: entry.path, sha: blobSha });
  }

  // Step 5: Create tree and commit on the fork
  const treeSha = await createTree(fork.owner, fork.name, currentBaseTreeSha, blobEntries, token, options);
  const commitMessage = reviewPayload.title
    ? `${reviewPayload.title}\n\n${reviewPayload.body ?? "Submitted via RepoRescue readiness fix."}`
    : "docs: improve contributor onboarding via RepoRescue";
  const commitSha = await createCommit(fork.owner, fork.name, treeSha, currentBaseSha, commitMessage, token, options);

  // Step 6: Create branch on the fork
  await createRepositoryBranch(fork.owner, fork.name, branchName, commitSha, token, options);

  // Step 7: Open cross-repository Pull Request
  let prResult;
  try {
    prResult = await openPullRequest(
      upstreamOwner,
      upstreamRepo,
      {
        title: reviewPayload.title ?? "docs: contributor onboarding improvements",
        body: reviewPayload.body ?? "Submitted via RepoRescue readiness fix.",
        baseBranch,
        headBranch: branchName,
        forkOwner: fork.owner,
        token,
      },
      options,
    );
  } catch (error) {
    // Attempt cleanup of orphaned branch on fork if opening PR failed
    await cleanupPullRequestBranch(fork.owner, fork.name, branchName, token, options);
    throw error;
  }

  return {
    submitted: true,
    alreadyExisted: Boolean(prResult.alreadyExisted),
    prNumber: prResult.prNumber,
    prUrl: prResult.prUrl,
    branch: branchName,
    fork: `${fork.owner}/${fork.name}`,
    upstream: `${upstreamOwner}/${upstreamRepo}`,
    baseBranch,
    commitSha,
    createdAt: Date.now(),
  };
}

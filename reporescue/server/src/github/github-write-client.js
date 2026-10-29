import crypto from "node:crypto";
import { ApiError } from "../http/errors.js";
import { githubApiOrigin, validateBranchName, validateGithubName, validateGithubLogin, validatePathSegment, validateSha } from "../github/github-app-config.js";

const WRITE_TIMEOUT_MS = 10_000;

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
  const status = typeof error?.status === "number" ? error.status : typeof error?.response?.status === "number" ? error.response.status : null;
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

function contentToSha(content) {
  return crypto.createHash("sha256").update(String(content), "utf8").digest("hex");
}

function loginName(value) {
  return validateGithubLogin(value);
}

function repoName(value) {
  return validateGithubName(value);
}

async function githubWriteRequest(path, { method = "GET", token, body, action, timeoutMs = WRITE_TIMEOUT_MS }) {
  const response = await fetch(`${githubApiOrigin()}${path}`, {
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

async function fetchBranchHeadSha(owner, repo, baseBranch, token) {
  const refPath = buildRefPath(owner, repo, baseBranch);
  const payload = await githubWriteRequest(refPath, {
    method: "GET",
    token,
    action: "Reading the base branch",
  });
  const sha = payload?.object?.sha ?? null;
  return sha ? validateSha(sha) : null;
}

async function fetchBranchSha(owner, repo, branchName, token) {
  const refPath = buildRefPath(owner, repo, branchName);
  const payload = await githubWriteRequest(refPath, {
    method: "GET",
    token,
    action: "Reading the pull request branch",
  });
  const sha = payload?.object?.sha ?? null;
  return sha ? validateSha(sha) : null;
}

async function fetchUserForks(owner, repo, session, token) {
  const forksPath = `/repos/${loginName(owner)}/${repoName(repo)}/forks?prefix=false`;
  const payload = await githubWriteRequest(forksPath, { method: "GET", token, action: "Listing forks for the destination repository" });
  return Array.isArray(payload) ? payload : [];
}

async function createUserFork(owner, repo, session, token) {
  const forksPath = `/repos/${loginName(owner)}/${repoName(repo)}/forks`;
  const payload = await githubWriteRequest(forksPath, {
    method: "POST",
    token,
    body: { default_branch_only: false, name: repoName(repo) },
    action: "Creating a fork of the destination repository",
  });
  const forkOwner = String(payload?.owner?.login ?? session.login).slice(0, 50);
  const forkName = String(payload?.name ?? repoName(repo)).slice(0, 100);
  return { owner: forkOwner, name: forkName };
}

async function checkExistingPullRequest(owner, repo, branchName, token) {
  const params = new URLSearchParams({ head: `${owner}:${branchName}`, state: "open" });
  const pullsPath = buildPullRequestsPath(owner, repo);
  const payload = await githubWriteRequest(`${pullsPath}?${params.toString()}`, { method: "GET", token, action: "Checking for an existing open pull request" });
  return Array.isArray(payload) ? payload.find((item) => item?.number && item?.head?.ref === branchName) : null;
}

async function createBinaryBlob(owner, repo, content, token) {
  const blobPath = `/repos/${loginName(owner)}/${repoName(repo)}/git/blobs`;
  const payload = await githubWriteRequest(blobPath, {
    method: "POST",
    token,
    body: { content: requestBodyContent(content), encoding: "base64" },
    action: "Writing a file blob",
  });
  return validateSha(payload?.sha);
}

async function createTree(owner, repo, baseSha, blobShas, token) {
  const treePayload = { base_tree: baseSha, tree: blobShas.map(({ path, sha }) => ({ mode: "100644", type: "blob", path: validatePathSegment(path), sha })) };
  const treePath = buildTreePath(owner, repo);
  const payload = await githubWriteRequest(treePath, { method: "POST", token, body: treePayload, action: "Storing the updated repository tree" });
  return validateSha(payload?.sha);
}

async function createCommit(owner, repo, treeSha, parentSha, title, token) {
  const commitPath = buildCommitPath(owner, repo);
  const payload = await githubWriteRequest(commitPath, { method: "POST", token, body: { message: title, tree: treeSha, parents: [parentSha] }, action: "Creating the pull request commit" });
  return validateSha(payload?.sha);
}

async function createRepositoryBranch(owner, repo, branchName, baseSha, token) {
  const refsPath = buildRefsPath(owner, repo);
  const payload = await githubWriteRequest(refsPath, {
    method: "POST",
    token,
    body: { ref: `refs/heads/${validateBranchName(branchName)}`, sha: baseSha },
    action: "Creating the pull request branch",
  });
  const sha = payload?.object?.sha ?? payload?.sha;
  return { refPath: refsPath, ref: branchName, sha: validateSha(sha) };
}

async function openPullRequest(owner, repo, title, body, baseBranch, headBranch, token) {
  const pullsPath = buildPullRequestsPath(owner, repo);
  return githubWriteRequest(pullsPath, {
    method: "POST",
    token,
    body: { title, head: `${loginName(owner)}:${validateBranchName(headBranch)}`, base: validateBranchName(baseBranch), body, maintainer_can_modify: false, draft: false },
    action: "Opening the pull request",
  });
}

async function resolveUserFork(owner, repo, session, token) {
  const existing = await waitForForkCreationForks(owner, repo, session, token);
  if (existing) return existing;
  const created = await createUserFork(owner, repo, session, token);
  return created;
}

async function cleanupPullRequest(owner, repo, branchName, token) {
  try {
    const existing = await fetchBranchSha(owner, repo, branchName, token);
    if (!existing) return { ok: true, reason: "No branch was created." };
    const refSha = validateSha(existing);
    await githubWriteRequest(buildRefsPath(owner, repo), { method: "DELETE", token, body: { ref: `${DEFAULT_REF_PREFIX}${validateBranchName(branchName)}` }, action: "Removing the pull request branch" });
    return { ok: true, reason: "The incomplete branch was removed." };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function preparePullRequestSubmission({
  assessment,
  session,
  destination,
  baseSha,
  fileContents,
  findingIds,
  plan,
  validateExpectations,
  reviewPayload,
}) {
  const token = session.accessToken;
  const owner = validateGithubLogin(assessment.repository?.owner ?? assessment.repository?.fullName?.split("/")[0] ?? "");
  const repo = validateGithubName(assessment.repository?.name ?? assessment.repository?.fullName?.split("/")[1] ?? "");
  const baseBranch = validateBranchName(destination.baseBranch ?? assessment.repository?.defaultBranch ?? "main");
  const currentBaseSha = await fetchBranchHeadSha(owner, repo, baseBranch, token);
  const currentBaseShaValidated = validateSha(destination.baseSha ?? currentBaseSha);
  if (currentBaseSha !== currentBaseShaValidated) {
    throw new ApiError("CONFLICT", "The base branch moved before the pull request could be started. Review and confirm the scan again.");
  }

  const previewState = await plan({ assessment, findingIds, preparedAt: reviewPayload.preparedAt, normalizedDestination: destination, currentBaseSha, payload: reviewPayload });
  const expectedContentsHash = previewState?.contentHash ?? null;
  const contentHashCandidates = [expectedContentsHash, reviewPayload.contentHash].filter(Boolean);
  const selectionsHashMatch = contentHashCandidates.some((candidate) => typeof candidate === "string" && candidate === reviewPayload.contentHashPreview && candidate === expectedContentsHash);
  if (!selectionsHashMatch) {
    await validateExpectations({
      expectedContentsHash: expectedContentsHash ?? reviewPayload.contentHash,
      actualContentHash: reviewPayload.contentHashPreview,
      findingIds,
      reviewPayload,
    });
  }

  const branchCandidate = String(reviewPayload.branchCandidate ?? "pr").slice(0, 48).replace(/[^a-zA-Z0-9._/-]/g, "-");
  const branchName = buildBranchName({ owner, repo, branchCandidate, currentBaseSha, currentBaseShaValidated });
  const existing = await checkExistingPullRequest(owner, repo, branchName, token);
  if (existing) {
    return {
      prepared: false,
      fileDetermined: true,
      currentBaseSha: currentBaseShaValidated,
      contentHash: unresolvedContentHashOf(reviewPayload),
      currentState: { alreadyOpen: true, openedPullRequest: existing },
      finalState: { alreadyOpen: true, openedPullRequest: existing },
    };
  }

  const fork = await resolveUserFork(owner, repo, session, token);
  if (!fork) {
    throw new ApiError("INSUFFICIENT_PERMISSION", "A fork of the repository could not be created because the user's GitHub access does not allow it.");
  }
  const blobEntries = [];
  for (const [path, content] of Object.entries(fileContents ?? reviewPayload.fileContents ?? {})) {
    blobEntries.push({ path, sha: await createBinaryBlob(fork.owner, fork.name, content, token) });
  }
  const treeSha = await createTree(fork.owner, fork.name, currentBaseShaValidated, blobEntries, token);
  const commitSha = await createCommit(fork.owner, fork.name, treeSha, currentBaseShaValidated, reviewPayload.title, token);
  await createRepositoryBranch(fork.owner, fork.name, branchName, commitSha, token);
  const cleanup = await cleanupPullRequest(fork.owner, fork.name, branchName, token);
  const pullRequest = await openPullRequest(fork.owner, fork.name, reviewPayload.title, reviewPayload.body, destination.baseBranch, branchName, token);
  return {
    prepared: false,
    fileDetermined: true,
    currentBaseSha: currentBaseShaValidated,
    contentHash: unresolvedContentHashOf(reviewPayload),
    currentState: { openedPullRequest: pullRequest, cleanup },
    finalState: { openedPullRequest: pullRequest, cleanup },
  };
}

const DEFAULT_REF_PREFIX = "refs/heads/";

function buildBranchName({ owner, repo, branchCandidate, currentBaseSha, currentBaseShaValidated }) {
  return `${sessionOwnerSegment(owner)}/${repoOwnerSegment(repo)}/${branchCandidate}-${currentBaseShaValidated.slice(0, 8)}`;
}

function sessionOwnerSegment(owner) {
  return String(owner).slice(0, 39);
}

function repoOwnerSegment(repo) {
  return String(repo).slice(0, 100);
}

function unresolvedContentHashOf(reviewPayload) {
  return typeof reviewPayload?.contentHashPreview === "string" ? reviewPayload.contentHashPreview : typeof reviewPayload?.contentHash === "string" ? reviewPayload.contentHash : null;
}

export { contentToSha, buildPullRequestBranchName };
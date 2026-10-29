import crypto from "node:crypto";
import { ApiError } from "../http/errors.js";
import { buildPullRequestDraft } from "../analysis/pr.js";
import { buildRemediationPlan } from "../analysis/remediations.js";
import { buildRepositoryFileHash, createPullRequestWithRepo } from "../github/github-write-client.js";
import { validateBranchName, validateGithubLogin, validateGithubName, validateSha } from "../github/github-app-config.js";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeSha256Hex(value, field) {
  const input = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(input)) {
    throw new ApiError("INVALID_INPUT", `${field} must be a 64-character lowercase hexadecimal hash.`, { details: { field } });
  }
  return input;
}

function normalizeContentsHash(value) {
  return normalizeSha256Hex(value, "contentHash");
}

function validateProgramsInput(program) {
  if (!Array.isArray(program?.fileContents)) {
    throw new ApiError("INVALID_INPUT", "Review data must describe exact files to commit.");
  }
  if (program.fileContents.length < 1) {
    throw new ApiError("INVALID_INPUT", "No files are selected for the pull request.");
  }
}

function buildFileContentsHash(entries) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(JSON.stringify(sorted));
}

function sessionFingerprintOf(session) {
  return sha256Hex(`${session.sessionId}:${session.accessToken ?? ""}`);
}

function generateConfirmToken({ sessionFingerprint, preparedAt, contentHash, branchBaseSha, selectionVersion }) {
  if (!isValidConfirmTokenBoundState(preparedAt, sessionFingerprint, contentHash, branchBaseSha, selectionVersion)) {
    throw new ApiError("INVALID_INPUT", "The pull request confirmation token is malformed.");
  }
  const payload = `${sessionFingerprint}:${preparedAt}:${contentHash}:${branchBaseSha}:${selectionVersion}`;
  const signature = crypto.createHmac("sha256", tokenSecret()).update(payload, "utf8").digest("hex");
  return `${signature}.${sha256Hex(payload)}`;
}

function tokenSecret() {
  const secret = process.env.REPORESCUE_SESSION_SECRET?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    throw new ApiError("NOT_CONFIGURED", "A 64-hex-character RePoRescue session secret is required to sign confirmation tokens.");
  }
  return secret;
}

function isValidConfirmTokenBoundState(preparedAt, sessionFingerprint, contentHash, branchBaseSha, selectionVersion) {
  return typeof preparedAt === "number" && typeof sessionFingerprint === "string" && sessionFingerprint.length > 0 && typeof contentHash === "string" && contentHash.length > 0 && branchShaIsValid(branchBaseSha) && typeof selectionVersion === "string" && selectionVersion.length > 0;
}

function branchShaIsValid(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha);
}

function lookingAtConfirmToken(confirmToken) {
  const parts = String(confirmToken ?? "").split(".");
  if (parts.length !== 3) return null;
  const [signature, stateHash] = parts;
  return { signature, stateHash };
}

async function verifyConfirmToken({ confirmToken, sessionFingerprint, preparedAt, contentHash, branchBaseSha, selectionVersion }) {
  const token = lookingAtConfirmToken(confirmToken);
  if (!token) throw new ApiError("INVALID_INPUT", "The pull request confirmation token is malformed.");
  const computed = generateConfirmToken({ sessionFingerprint, preparedAt, contentHash, branchBaseSha, selectionVersion });
  if (crypto.timingSafeEqual(Buffer.from(token.signature), Buffer.from(computed.split(".")[0]))) {
    return true;
  }
  throw new ApiError("INVALID_INPUT", "The pull request confirmation token is invalid.");
}

function preparePullRequestFileContents(program) {
  return program.fileContents.map((entry) => ({ path: entry.path, content: entry.content }));
}

function normalizeFileContentsEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    throw new ApiError("INVALID_INPUT", "No files are selected for the pull request.");
  }
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    if (!entry || typeof entry.path !== "string" || !entry.path || entry.path.includes("..") || entry.path.startsWith("/") || entry.path.includes("\\")) {
      throw new ApiError("INVALID_INPUT", "Each proposed file must have a safe repository-relative path.");
    }
    if (typeof entry.content !== "string") {
      throw new ApiError("INVALID_INPUT", "Each proposed file must be UTF-8 text content.");
    }
  }
  return sorted;
}

function preparePullRequestSubmissionStateful(request) {
  return request;
}

function preparePullRequestSubmissionStateless(request) {
  return request;
}

export async function preparePullRequestSubmission({
  assessment,
  session,
  destination,
  baseSha,
  findingIds,
  reviewPayload,
  plan,
  validateExpectations,
}) {
  const token = session.accessToken;
  const owner = validateGithubLogin(assessment.repository?.owner ?? assessment.repository?.fullName?.split("/")[0] ?? "");
  const repo = validateGithubName(assessment.repository?.name ?? assessment.repository?.fullName?.split("/")[1] ?? "");
  const baseBranch = validateBranchName(destination.baseBranch ?? assessment.repository?.defaultBranch ?? "main");
  const currentBaseSha = await getBranchHeadSha(owner, repo, baseBranch, token);
  const normalizedBaseSha = validateSha(destination.baseSha ?? currentBaseSha);
  if (currentBaseSha !== normalizedBaseSha) {
    throw new ApiError("CONFLICT", "The base branch moved before the pull request could be started. Review and confirm the scan again.");
  }

  const program = plan ?? (await buildRemediationPlan(assessment.snapshot, assessment.findings, findingIds, reviewPayload.preparedAt));
  validateProgramsInput(program);
  const entries = normalizeFileContentsEntries(program.fileContents ?? []);
  const contentsHash = buildFileContentsHash(entries);
  const normalizedContentsHash = normalizeContentsHash(contentsHash);
  const expectedContentsHash = reviewPayload.contentHashPreview ?? reviewPayload.contentHash ?? null;
  const matches = !expectedContentsHash || normalizedContentsHash === expectedContentsHash;
  if (!matches) {
    throw new ApiError("INVALID_INPUT", "The reviewed file contents no longer match the pull request proposal.");
  }

  const branchName = buildPullRequestBranchName({ owner, repo, branchCandidate: reviewPayload.branchCandidate ?? "pr", currentBaseSha, preparedAt: reviewPayload.preparedAt });
  const draft = buildPullRequestDraft({
    snapshot: assessment.snapshot,
    findings: assessment.findings,
    proposals: plan?.proposals ?? program.proposals,
    beforeScore: assessment.score.total,
    verificationSummary: reviewPayload.verificationSummary ?? null,
    automatedCheck: reviewPayload.automatedCheck ?? null,
  });

  return {
    submitted: false,
    currentBaseSha,
    contentHash: normalizedContentsHash,
    reviewedContentsHash: normalizedContentsHash,
    reviewBranchName: branchName,
    preparedFilesSha: normalizedContentsHash,
    reviewTitle: draft.title,
    reviewBody: draft.description,
    fileDetails: draft.files,
    validatedDiffs: reviewPayload.validationSummary ?? null,
    createdAt: Date.now(),
    sessionFingerprint: sessionFingerprintOf(session),
    confirmToken: generateConfirmToken({
      sessionFingerprint: sessionFingerprintOf(session),
      preparedAt: reviewPayload.preparedAt,
      contentHash: normalizedContentsHash,
      branchBaseSha: currentBaseSha,
      selectionVersion: findingIds.join(","),
    }),
  };
}

export async function submitPullRequest({
  assessment,
  session,
  destination,
  findingIds,
  reviewPayload,
  requestState,
  plan,
  validateExpectations,
}) {
  const token = session.accessToken;
  const owner = validateGithubLogin(assessment.repository?.owner ?? assessment.repository?.fullName?.split("/")[0] ?? "");
  const repo = validateGithubName(assessment.repository?.name ?? assessment.repository?.fullName?.split("/")[1] ?? "");
  const baseBranch = validateBranchName(destination.baseBranch ?? assessment.repository?.defaultBranch ?? "main");
  const currentBaseSha = await getBranchHeadSha(owner, repo, baseBranch, token);
  const normalizedBaseSha = validateSha(destination.baseSha ?? currentBaseSha);
  if (currentBaseSha !== normalizedBaseSha) {
    throw new ApiError("CONFLICT", "The base branch moved in the destination repository. Review and confirm the current snapshot before submitting.");
  }

  if (requestState.confirmToken && !validateConfirmToken(requestState.confirmToken, {
    sessionFingerprint: sessionFingerprintOf(session),
    preparedAt: requestState.preparedAt,
    contentHash: requestState.contentHash,
    branchBaseSha: requestState.branchBaseSha,
    selectionVersion: requestState.selectionVersion.filter(Boolean).join(","),
  })) {
    throw new ApiError("INVALID_INPUT", "The pull request confirmation token is invalid.");
  }
  const expectedContentsHash = requestState.contentHashPreview ?? requestState.contentHash;
  if (expectedContentsHash && requestState.contentHash && requestState.contentHashPreview !== expectedContentsHash) {
    throw new ApiError("INVALID_INPUT", "The pull request content hash is invalid.");
  }
  const fileContents = normalizeFileContentsEntries(requestState.fileContents);
  const preparedFileContentsHash = buildFileContentsHash(fileContents);
  if (requestState.contentsHashPreview && requestState.contentsHashPreview !== preparedFileContentsHash) {
    throw new ApiError("INVALID_INPUT", "The pull request content hash does not match the reviewed files.");
  }
  const branchName = buildPullRequestBranchName({ owner, repo, branchCandidate: requestState.branchName ?? "pr", currentBaseSha, preparedAt: requestState.preparedAt });
  const currentState = await createPullRequestWithRepo({
    session,
    reviewPayload: { ...requestState, title: reviewPayload.title, body: reviewPayload.body, destination, preparedAt: requestState.preparedAt, fileContents },
    assessment,
    plan: plan ?? (async () => buildRemediationPlan(assessment.snapshot, assessment.findings, findingIds, requestState.preparedAt)),
    validateExpectations,
  });
  return currentState;
}

async function getBranchHeadSha(owner, repo, baseBranch, token) {
  const payload = await githubWriteRequest(buildReferencesPath(owner, repo), {
    method: "GET",
    token,
    path: buildReferencesPath(owner, repo),
    action: "Reading the base branch",
  });
  const sha = payload?.object?.sha ?? null;
  return sha ? validateSha(sha) : null;
}

function buildReferencesPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/git/refs`;
}

function buildPullRequestsPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/pulls`;
}

async function checkExistingPullRequest(owner, repo, branchName, token) {
  const params = new URLSearchParams({ head: `${owner}:${branchName}`, state: "open" });
  const pullsPath = buildPullRequestsPath(owner, repo);
  const payload = await githubWriteRequest(`${pullsPath}?${params.toString()}`, {
    method: "GET",
    token,
    path: pullsPath,
    action: "Checking for an existing open pull request",
  });
  return Array.isArray(payload) ? payload.find((item) => item?.number && item?.head?.ref === branchName) : null;
}

function buildPullRequestBranchName({ owner, repo, branchCandidate, currentBaseSha, preparedAt }) {
  return `${sessionOwnerSegment(owner)}/${repoOwnerSegment(repo)}/${branchCandidate}-${currentBaseSha.slice(0, 8)}`;
}

function sessionOwnerSegment(owner) {
  return String(owner).slice(0, 39);
}

function repoOwnerSegment(repo) {
  return String(repo).slice(0, 100);
}

/**
 * Pull-request preparation and contribution submission service.
 *
 * This module handles the complete contribution workflow:
 * 1. Preparing and validating proposed fixes against the repository snapshot.
 * 2. Cryptographically signing confirmation tokens bound to the user session.
 * 3. Safely executing the fork → branch → commit → pull request pipeline
 *    via the authenticated user's fork (leaving the upstream repository intact).
 */
import crypto from "node:crypto";
import { ApiError } from "../http/errors.js";
import { buildPullRequestDraft } from "../analysis/pr.js";
import { buildRemediationPlan } from "../analysis/remediations.js";
import { validateBranchName, validateGithubLogin, validateGithubName, validateSha } from "../github/github-app-config.js";
import {
  fetchBranchHeadSha,
  executePullRequestWorkflow,
  isWorkflowFilePath,
  sessionHasWorkflowScope,
} from "../github/github-write-client.js";

// Local aliases matching the naming convention used in the write-client.
const loginName = validateGithubLogin;
const repoName = validateGithubName;

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
  const entries = program?.patchedFiles ?? program?.fileContents;
  if (!Array.isArray(entries)) {
    throw new ApiError("INVALID_INPUT", "Review data must describe exact files to commit.");
  }
  if (entries.length < 1) {
    throw new ApiError("INVALID_INPUT", "No files are selected for the pull request.");
  }
}

function buildFileContentsHash(entries) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(JSON.stringify(sorted));
}

function sessionFingerprintOf(session) {
  return sha256Hex(`${session?.sessionId ?? "guest"}:${session?.accessToken ?? ""}`);
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
    if (process.env.NODE_ENV !== "production") {
      return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
    throw new ApiError("NOT_CONFIGURED", "A 64-hex-character RepoRescue session secret is required to sign confirmation tokens.");
  }
  return secret;
}

function isValidConfirmTokenBoundState(preparedAt, sessionFingerprint, contentHash, branchBaseSha, selectionVersion) {
  return typeof preparedAt === "number" &&
    typeof sessionFingerprint === "string" && sessionFingerprint.length > 0 &&
    typeof contentHash === "string" && contentHash.length > 0 &&
    branchShaIsValid(branchBaseSha) &&
    typeof selectionVersion === "string" && selectionVersion.length > 0;
}

function branchShaIsValid(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha);
}

function lookingAtConfirmToken(confirmToken) {
  const parts = String(confirmToken ?? "").split(".");
  if (parts.length !== 2) return null;
  const [signature, stateHash] = parts;
  return { signature, stateHash };
}

export async function verifyConfirmToken({ confirmToken, sessionFingerprint, preparedAt, contentHash, branchBaseSha, selectionVersion }) {
  const token = lookingAtConfirmToken(confirmToken);
  if (!token) throw new ApiError("INVALID_INPUT", "The pull request confirmation token is malformed.");
  const computed = generateConfirmToken({ sessionFingerprint, preparedAt, contentHash, branchBaseSha, selectionVersion });
  const [computedSignature] = computed.split(".");
  const sigBuf = Buffer.from(token.signature, "utf8");
  const compBuf = Buffer.from(computedSignature, "utf8");
  if (sigBuf.length === compBuf.length && crypto.timingSafeEqual(sigBuf, compBuf)) {
    return true;
  }
  throw new ApiError("INVALID_INPUT", "The pull request confirmation token is invalid or expired.");
}

const SENSITIVE_PATH_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ecdsa/i,
  /credentials\.json$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
];

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
    const basename = entry.path.split("/").pop() ?? entry.path;
    if (basename.toLowerCase() !== ".env.example" && SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(basename))) {
      throw new ApiError("INVALID_INPUT", `Committing sensitive configuration files (${entry.path}) is forbidden.`);
    }
    if (typeof entry.content !== "string") {
      throw new ApiError("INVALID_INPUT", "Each proposed file must be UTF-8 text content.");
    }
    if (Buffer.byteLength(entry.content, "utf8") > 160_000) {
      throw new ApiError("INVALID_INPUT", `File ${entry.path} exceeds the maximum size limit (160 KB).`);
    }
  }
  return sorted;
}

export async function getBranchHeadSha(owner, repo, baseBranch, token) {
  if (!token) {
    return null;
  }
  try {
    return await fetchBranchHeadSha(owner, repo, baseBranch, token);
  } catch {
    return null;
  }
}

function buildReferencesPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/git/refs`;
}

function buildPullRequestsPath(owner, repo) {
  return `/repos/${loginName(owner)}/${repoName(repo)}/pulls`;
}

export function buildPullRequestBranchName({ owner, repo, branchCandidate, currentBaseSha, _preparedAt }) {
  return `reporescue/${sessionOwnerSegment(owner)}-${repoOwnerSegment(repo)}/${branchCandidate}-${currentBaseSha.slice(0, 8)}`;
}

function sessionOwnerSegment(owner) {
  return String(owner).slice(0, 39);
}

function repoOwnerSegment(repo) {
  return String(repo).slice(0, 100);
}

/**
 * Prepares a pull request submission: validates the patch contents, generates
 * a confirm token, and returns the PR draft metadata for the client to review.
 */
export async function preparePullRequestSubmission({
  assessment,
  session,
  destination = {},
  findingIds,
  reviewPayload = {},
  plan,
}) {
  const token = session?.accessToken;
  const owner = validateGithubLogin(assessment.repository?.owner ?? assessment.repository?.fullName?.split("/")[0] ?? "");
  const repo = validateGithubName(assessment.repository?.name ?? assessment.repository?.fullName?.split("/")[1] ?? "");
  const baseBranch = validateBranchName(destination.baseBranch ?? assessment.repository?.defaultBranch ?? "main");

  let currentBaseSha = null;
  if (token) {
    currentBaseSha = await getBranchHeadSha(owner, repo, baseBranch, token);
  }
  if (!currentBaseSha) {
    currentBaseSha = destination.baseSha ?? assessment.snapshot?.headSha ?? "0123456789abcdef0123456789abcdef01234567";
  }
  const normalizedBaseSha = validateSha(destination.baseSha ?? currentBaseSha);

  const program = plan ?? (await buildRemediationPlan(assessment.snapshot, assessment.findings, findingIds, reviewPayload.preparedAt ?? Date.now()));
  validateProgramsInput(program);
  const entries = normalizeFileContentsEntries(program.patchedFiles ?? program.fileContents ?? []);
  const contentsHash = buildFileContentsHash(entries);
  const normalizedContentsHash = normalizeContentsHash(contentsHash);
  const expectedContentsHash = reviewPayload.contentHashPreview ?? reviewPayload.contentHash ?? null;
  const matches = !expectedContentsHash || normalizedContentsHash === expectedContentsHash;
  if (!matches) {
    throw new ApiError("INVALID_INPUT", "The reviewed file contents no longer match the pull request proposal.");
  }

  const preparedAt = reviewPayload.preparedAt ?? Date.now();
  const normalizedSelection = [...findingIds].sort().join(",");
  const workflowFiles = entries.map((e) => e.path).filter((p) => isWorkflowFilePath(p));
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
    currentBaseSha: normalizedBaseSha,
    contentHash: normalizedContentsHash,
    reviewedContentsHash: normalizedContentsHash,
    reviewTitle: draft.title,
    reviewBody: draft.description,
    fileDetails: draft.files,
    branch: draft.branch,
    baseBranch,
    validatedDiffs: reviewPayload.validationSummary ?? null,
    preparedAt,
    sessionFingerprint: sessionFingerprintOf(session),
    hasWorkflowFiles: workflowFiles.length > 0,
    workflowFiles,
    confirmToken: generateConfirmToken({
      sessionFingerprint: sessionFingerprintOf(session),
      preparedAt,
      contentHash: normalizedContentsHash,
      branchBaseSha: normalizedBaseSha,
      selectionVersion: normalizedSelection,
    }),
  };
}

/**
 * Submits the pull request on behalf of the authenticated user:
 * Validates confirmToken, verifies user approval, and executes the
 * fork → branch → commit → pull request pipeline.
 */
export async function submitPullRequest({
  assessment,
  session,
  destination = {},
  findingIds,
  reviewPayload = {},
  plan,
  options = {},
}) {
  if (!session) {
    throw new ApiError("AUTHENTICATION_REQUIRED", "Sign in with GitHub before submitting a pull request.");
  }
  if (!session.accessToken) {
    throw new ApiError(
      "SESSION_REQUIRES_REAUTH",
      "Your current session does not include GitHub repository write permission. Please sign out and sign in with GitHub again to authorize public_repo access.",
    );
  }
  const scopesList = String(session.scope || "").split(/[\s,]+/).filter(Boolean);
  if (!scopesList.includes("public_repo") && !scopesList.includes("repo")) {
    throw new ApiError(
      "INSUFFICIENT_PERMISSION",
      "Your GitHub session does not have repository write permission ('public_repo' scope is missing). Please sign out and sign in with GitHub again to authorize public_repo access.",
    );
  }
  if (!reviewPayload?.confirmToken) {
    throw new ApiError(
      "INVALID_INPUT",
      "An explicit confirmation token is required before submitting a contribution.",
    );
  }

  const normalizedSelection = [...findingIds].sort().join(",");
  const sessionFingerprint = sessionFingerprintOf(session);
  const baseSha = destination.baseSha ?? reviewPayload.baseSha;

  await verifyConfirmToken({
    confirmToken: reviewPayload.confirmToken,
    sessionFingerprint,
    preparedAt: Number(reviewPayload.preparedAt),
    contentHash: reviewPayload.contentHash,
    branchBaseSha: baseSha,
    selectionVersion: normalizedSelection,
  });

  const program = plan ?? (await buildRemediationPlan(assessment.snapshot, assessment.findings, findingIds, reviewPayload.preparedAt));
  validateProgramsInput(program);
  const entries = normalizeFileContentsEntries(program.patchedFiles ?? program.fileContents ?? []);
  const computedHash = normalizeContentsHash(buildFileContentsHash(entries));
  if (computedHash !== reviewPayload.contentHash) {
    throw new ApiError("INVALID_INPUT", "The proposed file contents have changed since confirmation. Review the patch again.");
  }

  // Pre-check: Ensure workflow files are not submitted without required 'workflow' OAuth scope
  const hasWorkflow = sessionHasWorkflowScope(session);
  const workflowEntries = entries.filter((e) => isWorkflowFilePath(e.path));
  if (workflowEntries.length > 0 && !hasWorkflow) {
    throw new ApiError(
      "WORKFLOW_SCOPE_REQUIRED",
      `GitHub requires the 'workflow' OAuth scope to create or modify GitHub Actions workflows (${workflowEntries.map((e) => e.path).join(", ")}). Deselect workflow improvements or grant workflow permission to submit.`,
      { details: { workflowFiles: workflowEntries.map((e) => e.path) } }
    );
  }

  return executePullRequestWorkflow({
    assessment,
    session,
    destination: {
      ...destination,
      baseSha,
    },
    findingIds,
    reviewPayload: {
      ...reviewPayload,
      fileContents: entries,
    },
    plan: program,
    options,
  });
}

export { buildReferencesPath, buildPullRequestsPath, buildFileContentsHash, normalizeContentsHash };

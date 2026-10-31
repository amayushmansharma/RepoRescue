import { Router } from "express";
import { ApiError, asyncHandler, readSelection, sendOk } from "../http/errors.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { sessionForRequest, invalidateSessionForRequest } from "../auth/auth-service.js";
import {
  preparePullRequestSubmission,
  submitPullRequest,
} from "../services/pull-request-service.js";
import {
  ensureFindingSelection,
  loadAssessment,
  planFor,
  prDraftFor,
  previewFor,
  verifyFor,
} from "../services/remediation-service.js";
import { getVerification, savePullRequestRecord, listPullRequestRecords } from "../storage/scan-store.js";

export const remediationsRouter = Router();
export const pullRequestsRouter = Router();
export const verificationsRouter = Router();

remediationsRouter.post(
  "/preview",
  rateLimit({ scope: "remediation-preview", limit: 40, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const { scanId, findingIds } = readSelection(req);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    sendOk(res, previewFor(assessment, findingIds));
  }),
);

remediationsRouter.post(
  "/validate",
  rateLimit({ scope: "remediation-validate", limit: 40, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const { scanId, findingIds } = readSelection(req);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    const plan = planFor(assessment, findingIds);
    const results = plan.proposals.map((proposal) => ({
      proposalId: proposal.id,
      findingId: proposal.findingId,
      kind: proposal.kind,
      overallValidation: proposal.overallValidation,
      checks: proposal.validation,
      files: proposal.files.map((file) => ({ path: file.path, changeType: file.changeType })),
      limitations: proposal.limitations,
    }));
    sendOk(res, {
      scanId,
      repository: assessment.repository.fullName,
      filesConsidered: plan.patchedFiles.map((file) => file.path),
      results,
      summary: {
        proposals: results.length,
        passed: results.filter((result) => result.overallValidation === "passed").length,
        failed: results.filter((result) => result.overallValidation === "failed").length,
        skipped: results.filter((result) => result.overallValidation === "skipped" || result.overallValidation === "unavailable").length,
      },
      note: "Validators run on the server against regenerated content. Syntax validity is not proof that the project works.",
    });
  }),
);

pullRequestsRouter.post(
  "/preview",
  rateLimit({ scope: "pr-preview", limit: 40, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const { scanId, findingIds, verificationId } = readSelection(req);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    let verification = null;
    if (verificationId) {
      verification = await getVerification(verificationId);
      if (!verification) throw new ApiError("NOT_FOUND", "The referenced verification record could not be found.");
      if (verification.scanId !== scanId) throw new ApiError("INVALID_INPUT", "The verification belongs to a different scan.");
    }
    const session = sessionForRequest(req);
    const draft = prDraftFor(assessment, findingIds, { verification });
    let submission = null;
    try {
      const prepared = await preparePullRequestSubmission({
        assessment,
        session,
        destination: { baseBranch: draft.baseBranch },
        findingIds,
        reviewPayload: {
          verificationSummary: verification?.summary ?? null,
        },
      });
      const scopesList = String(session?.scope || "").split(/[\s,]+/).filter(Boolean);
      const hasWriteScope = scopesList.includes("public_repo") || scopesList.includes("repo");
      const hasWorkflowScope = scopesList.includes("workflow");
      submission = {
        confirmToken: prepared.confirmToken,
        preparedAt: prepared.preparedAt,
        contentHash: prepared.contentHash,
        baseSha: prepared.currentBaseSha,
        baseBranch: prepared.baseBranch,
        hasWriteScope,
        hasWorkflowScope,
        hasWorkflowFiles: prepared.hasWorkflowFiles ?? false,
        workflowFiles: prepared.workflowFiles ?? [],
        requiresReauth: session ? !hasWriteScope : false,
      };
    } catch (err) {
      if (err instanceof ApiError && err.code === "SESSION_REQUIRES_REAUTH") {
        res.setHeader("Set-Cookie", await invalidateSessionForRequest(req));
      }
      // Preview still succeeds even if unauthenticated or preparation token cannot be signed
    }

    sendOk(res, {
      draft,
      mode: assessment.mode,
      verificationId: verification?.id ?? null,
      performedRemoteWrites: false,
      submission,
    });
  }),
);

pullRequestsRouter.post(
  "/",
  rateLimit({ scope: "pr-submit", limit: 10, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const session = sessionForRequest(req);
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
        "Your current session does not include 'public_repo' permission. Please sign out and sign in with GitHub again to authorize public repository writes.",
      );
    }
    const { scanId, findingIds } = readSelection(req);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);

    const confirmToken = typeof req.body?.confirmToken === "string" ? req.body.confirmToken.trim() : "";
    if (!confirmToken) {
      throw new ApiError("INVALID_INPUT", "An explicit confirmation token is required before submitting a contribution.");
    }

    const verificationId = typeof req.body?.verificationId === "string" ? req.body.verificationId.trim() : null;
    let verification = null;
    if (verificationId) {
      verification = await getVerification(verificationId);
      if (!verification) throw new ApiError("NOT_FOUND", "The referenced verification record could not be found.");
    }

    let result;
    try {
      result = await submitPullRequest({
        assessment,
        session,
        destination: {
          baseBranch: req.body?.baseBranch,
          baseSha: req.body?.baseSha,
        },
        findingIds,
        reviewPayload: {
          confirmToken,
          preparedAt: req.body?.preparedAt,
          contentHash: req.body?.contentHash,
          baseSha: req.body?.baseSha,
          title: req.body?.title,
          body: req.body?.body,
          branchCandidate: req.body?.branchCandidate,
          verificationSummary: verification?.summary ?? null,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "SESSION_REQUIRES_REAUTH") {
        res.setHeader("Set-Cookie", await invalidateSessionForRequest(req));
      }
      throw err;
    }

    await savePullRequestRecord({
      scanId,
      findingIds,
      contributor: session.userId,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
      branch: result.branch,
      fork: result.fork,
      upstream: result.upstream,
      baseBranch: result.baseBranch,
      commitSha: result.commitSha,
      alreadyExisted: Boolean(result.alreadyExisted),
    });

    sendOk(res, result, 201);
  }),
);

pullRequestsRouter.get(
  "/:scanId",
  asyncHandler(async (req, res) => {
    const list = await listPullRequestRecords(req.params.scanId);
    sendOk(res, { pullRequests: list });
  }),
);

verificationsRouter.post(
  "/",
  rateLimit({ scope: "verification", limit: 20, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const { scanId, findingIds } = readSelection(req);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    const { record, storage } = await verifyFor(assessment, findingIds);
    sendOk(res, { verification: record, storage }, 201);
  }),
);

verificationsRouter.get(
  "/:verificationId",
  asyncHandler(async (req, res) => {
    const verification = await getVerification(req.params.verificationId);
    if (!verification) throw new ApiError("NOT_FOUND", "That verification record could not be found.");
    sendOk(res, { verification });
  }),
);

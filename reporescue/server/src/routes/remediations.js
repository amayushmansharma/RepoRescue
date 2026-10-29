import { Router } from "express";
import { ApiError, asyncHandler, readSelection, sendOk } from "../http/errors.js";
import { rateLimit } from "../middleware/rate-limit.js";
import {
  ensureFindingSelection,
  loadAssessment,
  planFor,
  prDraftFor,
  previewFor,
  verifyFor,
} from "../services/remediation-service.js";
import { getVerification } from "../storage/scan-store.js";

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
    sendOk(res, {
      draft: prDraftFor(assessment, findingIds, { verification }),
      mode: assessment.mode,
      verificationId: verification?.id ?? null,
      performedRemoteWrites: false,
    });
  }),
);

/**
 * GitHub delivery is intentionally not implemented as a write path in this
 * build. The endpoint exists so the capability state is explicit and the
 * client never has to guess: it answers 501 NOT_CONFIGURED and performs no
 * remote operation of any kind.
 */
pullRequestsRouter.post(
  "/",
  asyncHandler(async () => {
    throw new ApiError(
      "NOT_CONFIGURED",
      "GitHub pull request delivery is disabled in this build. Export the review ZIP and open the pull request yourself; no fork, branch, commit or PR was created.",
      { details: { capability: "github-delivery", state: "not-configured", remoteWritesPerformed: false } },
    );
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

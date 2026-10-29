import { Router } from "express";
import { ApiError, asyncHandler, ensureString, ensureStringArray, readJsonBody, sendOk } from "../http/errors.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { buildReviewExport } from "../export/review-export.js";
import { filterFindings } from "../services/findings-service.js";
import { ensureFindingSelection, loadAssessment, scoreBreakdownFor } from "../services/remediation-service.js";
import { createDemoScan, createLiveScan, githubAccessMode, rescanAssessment, toScanDetail } from "../services/scan-service.js";
import { isValidProgressId } from "../services/scan-progress.js";
import { listStoredScans } from "../storage/scan-store.js";

export const scansRouter = Router();

scansRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const scans = await listStoredScans(20);
    sendOk(res, { scans, count: scans.length });
  }),
);

scansRouter.post(
  "/",
  rateLimit({ scope: "scan", limit: 12, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const payload = readJsonBody(req);
    const requestedMode = typeof payload.mode === "string" ? payload.mode : undefined;
    const demoId = typeof payload.demoId === "string" ? payload.demoId.trim() : undefined;
    const repository = typeof payload.repository === "string" ? payload.repository.trim() : undefined;
    const mode = requestedMode ?? (demoId ? "demo" : repository ? "live" : undefined);
    if (mode !== "demo" && mode !== "live") {
      throw new ApiError("INVALID_INPUT", 'Provide either "demoId" or "repository" (or an explicit mode).');
    }
    // Optional client-generated id so the UI can follow the real server-side
    // lifecycle. Without it the scan still works; the UI shows "working".
    const progressId = isValidProgressId(payload.progressId) ? payload.progressId : undefined;
    const started = Date.now();
    const assessment =
      mode === "demo"
        ? await createDemoScan(ensureString(demoId, "demoId", { max: 64 }), progressId)
        : await createLiveScan(ensureString(repository, "repository", { max: 300 }), progressId);
    sendOk(
      res,
      {
        scan: toScanDetail(assessment),
        meta: {
          durationMs: Date.now() - started,
          storage: assessment.storage,
          accessMode: mode === "live" ? githubAccessMode() : "fixture",
        },
      },
      201,
    );
  }),
);

scansRouter.get(
  "/:scanId",
  asyncHandler(async (req, res) => {
    const assessment = await loadAssessment(req.params.scanId);
    sendOk(res, { scan: toScanDetail(assessment) });
  }),
);

scansRouter.get(
  "/:scanId/findings",
  asyncHandler(async (req, res) => {
    const assessment = await loadAssessment(req.params.scanId);
    const q = req.query;
    const pick = (key) => (typeof q[key] === "string" ? q[key] : null);
    const findings = filterFindings(assessment.findings, {
      severity: pick("severity"),
      category: pick("category"),
      q: pick("q"),
      sort: pick("sort"),
      fixable: pick("fixable"),
    });
    sendOk(res, {
      scanId: assessment.scanId,
      repository: assessment.repository.fullName,
      mode: assessment.mode,
      total: assessment.findings.length,
      returned: findings.length,
      findings,
    });
  }),
);

scansRouter.get(
  "/:scanId/score",
  asyncHandler(async (req, res) => {
    const assessment = await loadAssessment(req.params.scanId);
    sendOk(res, scoreBreakdownFor(assessment));
  }),
);

scansRouter.get(
  "/:scanId/report",
  asyncHandler(async (req, res) => {
    const assessment = await loadAssessment(req.params.scanId);
    const detail = toScanDetail(assessment);
    sendOk(res, {
      scan: detail,
      score: scoreBreakdownFor(assessment),
      findingsBySeverity: detail.summary.bySeverity,
      generatedAt: new Date().toISOString(),
    });
  }),
);

scansRouter.post(
  "/:scanId/rescan",
  rateLimit({ scope: "rescan", limit: 6, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const previous = await loadAssessment(req.params.scanId);
    const assessment = await rescanAssessment(previous);
    sendOk(res, {
      scan: toScanDetail(assessment),
      meta: { previousScanId: previous.scanId, previousScore: previous.score.total, storage: assessment.storage },
    });
  }),
);

scansRouter.post(
  "/:scanId/export",
  rateLimit({ scope: "review-export", limit: 20, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const body = readJsonBody(req);
    const findingIds = ensureStringArray(body.findingIds, "findingIds", { minItems: 1, maxItems: 30, itemMaxLength: 80 });
    const assessment = await loadAssessment(req.params.scanId);
    ensureFindingSelection(assessment, findingIds);
    let reviewExport;
    try {
      reviewExport = buildReviewExport(assessment, findingIds);
    } catch (error) {
      if (error instanceof Error && /No safe patch files/.test(error.message)) {
        throw new ApiError("NO_REMEDIATION", error.message);
      }
      throw error;
    }
    res
      .status(200)
      .set({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${reviewExport.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(Buffer.from(reviewExport.bytes));
  }),
);

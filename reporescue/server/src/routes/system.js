import { Router } from "express";
import { ApiError, asyncHandler, sendOk } from "../http/errors.js";
import { AUTOMATED_REMEDIATION_RULE_IDS } from "../analysis/remediations.js";
import { evaluateRepository } from "../analysis/rules.js";
import { buildSnapshot } from "../analysis/snapshot.js";
import { DEMO_FIXTURES, DEMO_REPOSITORIES, filesFromFixture } from "../demo/fixtures.js";
import { githubAccessMode } from "../services/scan-service.js";
import { storageStatus } from "../storage/scan-store.js";
import { readProgress } from "../services/scan-progress.js";
import { DIMENSION_LABELS, DIMENSION_WEIGHTS } from "../../../shared/constants.js";
import { SCORE_FORMULA_TEXT } from "../../../shared/scoring-text.js";

export const systemRouter = Router();

export const API_ROUTES = [
  ["GET", "/api/health", "Service, storage, GitHub credential mode and write-policy status"],
  ["GET", "/api/config/capabilities", "Feature availability, scoring model and rule catalogue"],
  ["GET", "/api/demo-repositories", "Bundled deterministic fixtures"],
  ["POST", "/api/scans", "Create a demo (`demoId`) or live (`repository`) scan"],
  ["GET", "/api/scans", "Recent scan history"],
  ["GET", "/api/scans/:scanId", "Client-safe assessment (no repository file bodies)"],
  ["GET", "/api/scans/:scanId/findings", "Filtered findings (severity, category, q, sort, fixable)"],
  ["GET", "/api/scans/:scanId/score", "Dimension breakdown, deductions and limitations"],
  ["GET", "/api/scans/:scanId/report", "Assessment and score in one payload"],
  ["POST", "/api/scans/:scanId/rescan", "Fresh evidence, new scan record"],
  ["POST", "/api/scans/:scanId/export", "ZIP of selected proposed files, patch, manifest and review guide"],
  ["POST", "/api/remediations/preview", "Rule-based patches and diffs for selected findings"],
  ["POST", "/api/remediations/validate", "Server-side validation of regenerated patches"],
  ["POST", "/api/pull-requests/preview", "PR title, branch, description and checklist (preview only)"],
  ["POST", "/api/pull-requests", "Always 501 NOT_CONFIGURED: remote writes are disabled"],
  ["POST", "/api/verifications", "Record a local verification"],
  ["GET", "/api/verifications/:id", "Retrieve recorded verification evidence"],
];

systemRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const storage = await storageStatus();
    res.status(200).json({
      ok: true,
      service: "reporescue",
      time: new Date().toISOString(),
      checks: {
        storage: `${storage.mode}: ${storage.detail}`,
        githubToken:
          githubAccessMode() === "authenticated"
            ? "configured (server-side only)"
            : "not configured (public, anonymous GitHub access)",
        llm: "not used: findings come from deterministic rules",
        reviewExport: "available (server-generated ZIP; no GitHub write)",
        remoteWrites: "disabled",
      },
    });
  }),
);

/**
 * Polled by the scan launcher while its POST /api/scans request is in flight.
 * Returns only the phases the server actually recorded.
 */
systemRouter.get(
  "/scans/progress/:progressId",
  asyncHandler(async (req, res) => {
    const snapshot = readProgress(req.params.progressId);
    if (!snapshot) {
      throw new ApiError("NOT_FOUND", "That scan progress record is unknown or has expired.");
    }
    sendOk(res, snapshot);
  }),
);

systemRouter.get(
  "/demo-repositories",
  asyncHandler(async (_req, res) => {
    sendOk(res, {
      repositories: DEMO_REPOSITORIES,
      note: "Bundled deterministic fixtures. They exercise the same analysis engine as a live scan and require no GitHub credentials.",
    });
  }),
);

systemRouter.get(
  "/config/capabilities",
  asyncHandler(async (_req, res) => {
    const fixture = DEMO_FIXTURES[0];
    const snapshot = buildSnapshot({
      repository: fixture.repository,
      files: filesFromFixture(fixture),
      tree: [...fixture.files.map((file) => file.path), ...fixture.treeExtra],
      mode: "demo",
      fetchedAt: fixture.fetchedAt,
      analysisLimitations: [],
    });
    const { checks } = evaluateRepository(snapshot);
    const storage = await storageStatus();
    sendOk(res, {
      capabilities: {
        demoScan: { available: true, note: "Deterministic bundled fixtures; no network or credentials needed." },
        liveScan: { available: true, accessMode: githubAccessMode(), note: "Read-only GitHub REST + raw file access for public repositories." },
        reviewExport: { available: true, note: "Server-generated ZIP; contains proposals only." },
        localVerification: { available: true, note: "Rule re-evaluation against an in-memory patched workspace." },
        githubDelivery: { available: false, state: "not-configured", note: "No fork, branch, commit or pull request is ever created in this build." },
        remoteCi: { available: false, state: "not-run", note: "No commit is pushed, so no CI evidence can exist." },
        aiAssistance: { available: false, note: "Not used. Findings and patches come from deterministic rules." },
        storage,
      },
      scoring: {
        weights: DIMENSION_WEIGHTS,
        labels: DIMENSION_LABELS,
        formula: SCORE_FORMULA_TEXT,
      },
      ruleCatalogue: {
        fixture: fixture.repository.fullName,
        checks: checks.map((check) => ({ id: check.id, label: check.label, dimension: check.dimension, weight: check.weight, status: check.status })),
      },
      automatedRemediationRuleIds: AUTOMATED_REMEDIATION_RULE_IDS,
      apiRoutes: API_ROUTES,
    });
  }),
);

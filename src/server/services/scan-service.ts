import { randomUUID } from "node:crypto";
import type { Finding, ReadinessScore, RepositorySnapshot, ScanDetail, ScanStatus, ScanSummary, StoredAssessment } from "@/lib/types";
import { InvalidRepositoryError, normalizeRepositoryInput } from "@/server/analysis/normalize";
import { evaluateRepository } from "@/server/analysis/rules";
import { computeScore, summariseFindings } from "@/server/analysis/score";
import { buildSnapshot } from "@/server/analysis/snapshot";
import { filesFromFixture, getDemoFixture } from "@/server/demo/fixtures";
import { fetchRepositorySnapshot } from "@/server/github/client";
import { ApiError } from "@/server/http/errors";
import { saveScan } from "@/server/store/scan-store";
import { beginProgress, finishProgress, markProgress } from "@/server/services/scan-progress";

export type AssessmentCore = {
  findings: Finding[];
  score: ReadinessScore;
  summary: ScanSummary;
  status: ScanStatus;
  limitations: string[];
  nextSteps: string[];
};

export function assessSnapshot(snapshot: RepositorySnapshot, progressId?: string): AssessmentCore {
  const { checks, findings } = evaluateRepository(snapshot);
  markProgress(progressId, "running-rules");
  const score = computeScore(checks);
  markProgress(progressId, "calculating-score");
  const summary = summariseFindings(findings);
  const limitations = Array.from(new Set([...snapshot.analysisLimitations, ...score.limitations]));

  const nextSteps: string[] = [];
  if (summary.autoFixable > 0) {
    nextSteps.push(
      `${summary.autoFixable} finding${summary.autoFixable === 1 ? "" : "s"} have a safe, reviewable patch. Continue to FIX to inspect the proposed diffs before anything else happens.`,
    );
  }
  if (summary.bySeverity.high + summary.bySeverity.critical > 0) {
    nextSteps.push(
      `Review the ${summary.bySeverity.critical + summary.bySeverity.high} high-severity finding${summary.bySeverity.critical + summary.bySeverity.high === 1 ? "" : "s"} first: they block a first-time contributor.`,
    );
  }
  if (summary.manualOnly > 0) {
    nextSteps.push(
      `${summary.manualOnly} finding${summary.manualOnly === 1 ? "" : "s"} need a human decision (for example license choice or a new test suite). RepoRescue will not guess.`,
    );
  }
  nextSteps.push(
    "Run VERIFY after reviewing fixes: it re-runs the analysis rules against a patched workspace. It cannot report CI or merge state because nothing is pushed.",
  );
  if (snapshot.mode === "demo") {
    nextSteps.push("The demo data is a bundled fixture. Scan a public GitHub repository to run the same rules against live evidence.");
  }

  return {
    findings,
    score,
    summary,
    status: snapshot.mode === "demo" ? "completed" : "completed-with-limits",
    limitations,
    nextSteps,
  };
}

function buildAssessment(input: {
  scanId: string;
  snapshot: RepositorySnapshot;
  core: AssessmentCore;
}): StoredAssessment {
  const { snapshot, core } = input;
  return {
    scanId: input.scanId,
    mode: snapshot.mode,
    status: core.status,
    repository: snapshot.repository,
    ecosystem: snapshot.ecosystem,
    createdAt: new Date().toISOString(),
    findings: core.findings,
    score: core.score,
    summary: core.summary,
    limitations: core.limitations,
    nextSteps: core.nextSteps,
    snapshot,
    storage: "database",
  };
}

export async function createDemoScan(demoId: string, progressId?: string): Promise<StoredAssessment> {
  if (progressId) beginProgress(progressId);
  try {
    return await runDemoScan(demoId, progressId);
  } catch (error) {
    finishProgress(progressId, "failed");
    throw error;
  }
}

async function runDemoScan(demoId: string, progressId?: string): Promise<StoredAssessment> {
  const fixture = getDemoFixture(demoId);
  if (!fixture) {
    throw new ApiError("INVALID_INPUT", "Unknown demo repository.", {
      details: { available: ["beacon-api", "tidewatch"] },
    });
  }
  markProgress(progressId, "normalising-input");
  const snapshot = buildSnapshot({
    repository: fixture.repository,
    files: filesFromFixture(fixture),
    tree: [...fixture.files.map((file) => file.path), ...fixture.treeExtra],
    mode: "demo",
    fetchedAt: fixture.fetchedAt,
    analysisLimitations: [
      "DEMO SCAN: this assessment was produced from a bundled fixture, not from GitHub.",
      ...fixture.limitations,
    ],
  });
  markProgress(progressId, "normalising-content");
  const core = assessSnapshot(snapshot, progressId);
  const assessment = buildAssessment({ scanId: randomUUID(), snapshot, core });
  markProgress(progressId, "saving-assessment");
  const storage = await saveScan(assessment);
  finishProgress(progressId, "complete");
  return { ...assessment, storage };
}

export async function createLiveScan(repositoryInput: string, progressId?: string): Promise<StoredAssessment> {
  if (progressId) beginProgress(progressId);
  try {
    return await runLiveScan(repositoryInput, progressId);
  } catch (error) {
    finishProgress(progressId, "failed");
    throw error;
  }
}

async function runLiveScan(repositoryInput: string, progressId?: string): Promise<StoredAssessment> {
  markProgress(progressId, "normalising-input");
  let normalized;
  try {
    normalized = normalizeRepositoryInput(repositoryInput);
  } catch (error) {
    if (error instanceof InvalidRepositoryError) {
      throw new ApiError("INVALID_REPOSITORY", error.message);
    }
    throw error;
  }

  markProgress(progressId, "fetching-metadata");
  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
  const result = await fetchRepositorySnapshot(normalized, token);
  markProgress(progressId, "discovering-files");
  const core = assessSnapshot(result.snapshot, progressId);
  const assessment = buildAssessment({ scanId: randomUUID(), snapshot: result.snapshot, core });
  markProgress(progressId, "saving-assessment");
  const storage = await saveScan(assessment);
  finishProgress(progressId, "complete");
  return { ...assessment, storage };
}

export async function rescanAssessment(assessment: StoredAssessment): Promise<StoredAssessment> {
  if (assessment.mode === "demo") {
    const fixture = getDemoFixture(assessment.repository.name);
    if (!fixture) throw new ApiError("NOT_FOUND", "The demo fixture for this scan is no longer available.");
    return createDemoScan(fixture.id);
  }
  const snapshot = buildSnapshot({
    repository: {
      ...assessment.repository,
    },
    files: [],
    tree: [],
    mode: "live",
    fetchedAt: new Date().toISOString(),
    analysisLimitations: ["Re-scan requested for the same repository selector."],
  });
  // Re-use the selector stored with the scan; the snapshot above is only a
  // placeholder so the selector survives a repository rename.
  void snapshot;
  return createLiveScan(assessment.repository.fullName);
}

export function toScanDetail(assessment: StoredAssessment): ScanDetail {
  const { snapshot, ...rest } = assessment;
  return {
    ...rest,
    snapshot: {
      fileCount: snapshot.files.length,
      treeCount: snapshot.tree.length,
      paths: snapshot.tree.slice(0, 80),
      fetchedAt: snapshot.fetchedAt,
      analysisLimitations: snapshot.analysisLimitations,
    },
  };
}

export function githubAccessMode(): "anonymous" | "authenticated" {
  return process.env.GITHUB_TOKEN?.trim() ? "authenticated" : "anonymous";
}

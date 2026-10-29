import type { PullRequestDraft, RemediationProposal, StoredAssessment, VerificationRecord } from "@/lib/types";
import { buildPullRequestDraft } from "@/server/analysis/pr";
import { buildRemediationPlan, type RemediationPlan } from "@/server/analysis/remediations";
import { runLocalVerification } from "@/server/analysis/verify";
import { ApiError } from "@/server/http/errors";
import { getStoredScan, saveVerification } from "@/server/store/scan-store";

export async function loadAssessment(scanId: string): Promise<StoredAssessment> {
  if (!scanId || scanId.length > 64) {
    throw new ApiError("INVALID_INPUT", "A valid scanId is required.", { details: { field: "scanId" } });
  }
  const stored = await getStoredScan(scanId);
  if (!stored) {
    throw new ApiError("NOT_FOUND", "That scan could not be found. It may have been created in another server instance; run a new scan.");
  }
  return stored.assessment;
}

export function ensureFindingSelection(assessment: StoredAssessment, findingIds: string[]): string[] {
  const known = new Set(assessment.findings.map((finding) => finding.id));
  const unknown = findingIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ApiError("INVALID_INPUT", "One or more selected findings are not part of this scan.", {
      details: { unknownFindingIds: unknown.slice(0, 10) },
    });
  }
  return findingIds;
}

export function planFor(assessment: StoredAssessment, findingIds: string[], now = new Date().toISOString()): RemediationPlan {
  return buildRemediationPlan(assessment.snapshot, assessment.findings, findingIds, now);
}

export type PreviewPayload = {
  scanId: string;
  repository: string;
  mode: StoredAssessment["mode"];
  proposals: RemediationProposal[];
  unresolved: { findingId: string; reason: string }[];
  totals: {
    proposals: number;
    patchProposals: number;
    manualProposals: number;
    files: number;
    additions: number;
    deletions: number;
    validationPassed: number;
    validationFailed: number;
    validationSkipped: number;
  };
  boundaryNote: string;
};

export function previewFor(assessment: StoredAssessment, findingIds: string[]): PreviewPayload {
  const plan = planFor(assessment, findingIds);
  const patchProposals = plan.proposals.filter((proposal) => proposal.kind === "patch");
  const validationStates = patchProposals.flatMap((proposal) => proposal.validation);
  return {
    scanId: assessment.scanId,
    repository: assessment.repository.fullName,
    mode: assessment.mode,
    proposals: plan.proposals,
    unresolved: plan.unresolved,
    totals: {
      proposals: plan.proposals.length,
      patchProposals: patchProposals.length,
      manualProposals: plan.proposals.length - patchProposals.length,
      files: plan.patchedFiles.length,
      additions: patchProposals.reduce((total, proposal) => total + proposal.files.reduce((sum, file) => sum + file.additions, 0), 0),
      deletions: patchProposals.reduce((total, proposal) => total + proposal.files.reduce((sum, file) => sum + file.deletions, 0), 0),
      validationPassed: validationStates.filter((check) => check.state === "passed").length,
      validationFailed: validationStates.filter((check) => check.state === "failed").length,
      validationSkipped: validationStates.filter((check) => check.state === "skipped" || check.state === "unavailable").length,
    },
    boundaryNote:
      "PREVIEW ONLY: patches were generated in memory from documented remediation rules. No repository file was modified and no GitHub write was performed.",
  };
}

export async function verifyFor(assessment: StoredAssessment, findingIds: string[]): Promise<{ record: VerificationRecord; storage: string }> {
  const record = runLocalVerification({ assessment, findingIds });
  const storage = await saveVerification(record);
  return { record, storage };
}

export function prDraftFor(
  assessment: StoredAssessment,
  findingIds: string[],
  options: { verification?: VerificationRecord | null } = {},
): PullRequestDraft {
  const plan = planFor(assessment, findingIds);
  const verification = options.verification ?? null;
  return buildPullRequestDraft({
    snapshot: assessment.snapshot,
    findings: assessment.findings,
    proposals: plan.proposals,
    beforeScore: assessment.score.total,
    verificationSummary: verification?.summary ?? null,
    automatedCheck: verification?.comparison
      ? {
          passed: verification.comparison.resolved.length,
          failed: verification.comparison.remaining.length,
          skipped: 0,
        }
      : null,
  });
}

export function scoreBreakdownFor(assessment: StoredAssessment) {
  return {
    scanId: assessment.scanId,
    repository: assessment.repository.fullName,
    mode: assessment.mode,
    total: assessment.score.total,
    coverage: assessment.score.coverage,
    formula: assessment.score.formula,
    dimensions: assessment.score.dimensions,
    deductions: assessment.score.deductions,
    limitations: assessment.score.limitations,
  };
}

import { jsonError, jsonOk } from "@/server/http/errors";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { readSelection } from "@/server/http/selection";
import { ensureFindingSelection, loadAssessment, planFor } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, { scope: "remediation-validate", limit: 40, windowMs: 60_000 });
    const { scanId, findingIds } = await readSelection(request);
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

    return jsonOk({
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
  } catch (error) {
    return jsonError(error);
  }
}

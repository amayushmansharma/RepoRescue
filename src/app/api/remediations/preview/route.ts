import { jsonError, jsonOk } from "@/server/http/errors";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { readSelection } from "@/server/http/selection";
import { ensureFindingSelection, loadAssessment, previewFor } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, { scope: "remediation-preview", limit: 40, windowMs: 60_000 });
    const { scanId, findingIds } = await readSelection(request);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    return jsonOk(previewFor(assessment, findingIds));
  } catch (error) {
    return jsonError(error);
  }
}

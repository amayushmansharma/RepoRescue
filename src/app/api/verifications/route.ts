import { jsonError, jsonOk } from "@/server/http/errors";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { readSelection } from "@/server/http/selection";
import { ensureFindingSelection, loadAssessment, verifyFor } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, { scope: "verification", limit: 20, windowMs: 60_000 });
    const { scanId, findingIds } = await readSelection(request);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    const { record, storage } = await verifyFor(assessment, findingIds);
    return jsonOk({ verification: record, storage }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

import { jsonError, jsonOk } from "@/server/http/errors";
import { loadAssessment, scoreBreakdownFor } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ scanId: string }> }) {
  try {
    const { scanId } = await context.params;
    const assessment = await loadAssessment(scanId);
    return jsonOk(scoreBreakdownFor(assessment));
  } catch (error) {
    return jsonError(error);
  }
}

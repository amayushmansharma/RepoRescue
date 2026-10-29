import { jsonError, jsonOk } from "@/server/http/errors";
import { toScanDetail } from "@/server/services/scan-service";
import { loadAssessment } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ scanId: string }> }) {
  try {
    const { scanId } = await context.params;
    const assessment = await loadAssessment(scanId);
    return jsonOk({ scan: toScanDetail(assessment) });
  } catch (error) {
    return jsonError(error);
  }
}

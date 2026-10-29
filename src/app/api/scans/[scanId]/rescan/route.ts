import { enforceRateLimit } from "@/server/http/rate-limit";
import { jsonError, jsonOk } from "@/server/http/errors";
import { loadAssessment } from "@/server/services/remediation-service";
import { rescanAssessment, toScanDetail } from "@/server/services/scan-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ scanId: string }> }) {
  try {
    enforceRateLimit(request, { scope: "rescan", limit: 6, windowMs: 60_000 });
    const { scanId } = await context.params;
    const previous = await loadAssessment(scanId);
    const assessment = await rescanAssessment(previous);
    return jsonOk({
      scan: toScanDetail(assessment),
      meta: {
        previousScanId: previous.scanId,
        previousScore: previous.score.total,
        storage: assessment.storage,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

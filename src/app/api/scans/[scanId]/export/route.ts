import { ApiError, ensureObject, ensureStringArray, jsonError, readJsonBody } from "@/server/http/errors";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { buildReviewExport } from "@/server/export/review-export";
import { ensureFindingSelection, loadAssessment } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

/**
 * Download a review package. This is intentionally a binary endpoint rather
 * than a JSON API: proposed patches are reconstructed server-side and returned
 * as a ZIP, never accepted as client-controlled file contents.
 */
export async function POST(request: Request, context: { params: Promise<{ scanId: string }> }) {
  try {
    enforceRateLimit(request, { scope: "review-export", limit: 20, windowMs: 60_000 });
    const { scanId } = await context.params;
    const body = ensureObject(await readJsonBody(request), "body");
    const findingIds = ensureStringArray(body.findingIds, "findingIds", { minItems: 1, maxItems: 30, itemMaxLength: 80 });
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);
    const reviewExport = buildReviewExport(assessment, findingIds);

    // Copy into an owned ArrayBuffer. The ZIP builder returns a Uint8Array,
    // while the Web Response type requires an ArrayBuffer-backed BodyInit.
    const binary = new Uint8Array(reviewExport.bytes.byteLength);
    binary.set(reviewExport.bytes);
    return new Response(binary.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${reviewExport.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "No safe patch files are available for the selected findings.") {
      return jsonError(new ApiError("NO_REMEDIATION", error.message));
    }
    return jsonError(error);
  }
}

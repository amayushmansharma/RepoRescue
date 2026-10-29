import { ApiError, jsonError, jsonOk } from "@/server/http/errors";
import { readProgress } from "@/server/services/scan-progress";

export const dynamic = "force-dynamic";

/**
 * Polled by the scan launcher while its POST /api/scans request is in flight.
 * Returns the phases the server actually recorded, or 404 for unknown ids.
 */
export async function GET(_request: Request, context: { params: Promise<{ progressId: string }> }) {
  try {
    const { progressId } = await context.params;
    const snapshot = readProgress(progressId);
    if (!snapshot) {
      throw new ApiError("NOT_FOUND", "That scan progress record is unknown or has expired.");
    }
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(error);
  }
}

import { ApiError, jsonError, jsonOk } from "@/server/http/errors";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { readSelection } from "@/server/http/selection";
import { ensureFindingSelection, loadAssessment, prDraftFor } from "@/server/services/remediation-service";
import { getVerification } from "@/server/store/scan-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, { scope: "pr-preview", limit: 40, windowMs: 60_000 });
    const { scanId, findingIds, verificationId } = await readSelection(request);
    const assessment = await loadAssessment(scanId);
    ensureFindingSelection(assessment, findingIds);

    let verification = null;
    if (verificationId) {
      verification = await getVerification(verificationId);
      if (!verification) throw new ApiError("NOT_FOUND", "The referenced verification record could not be found.");
      if (verification.scanId !== scanId) throw new ApiError("INVALID_INPUT", "The verification belongs to a different scan.");
    }

    const draft = prDraftFor(assessment, findingIds, { verification });
    return jsonOk({
      draft,
      mode: assessment.mode,
      verificationId: verification?.id ?? null,
      performedRemoteWrites: false,
    });
  } catch (error) {
    return jsonError(error);
  }
}

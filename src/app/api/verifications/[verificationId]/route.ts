import { ApiError, jsonError, jsonOk } from "@/server/http/errors";
import { getVerification } from "@/server/store/scan-store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ verificationId: string }> }) {
  try {
    const { verificationId } = await context.params;
    const verification = await getVerification(verificationId);
    if (!verification) {
      throw new ApiError("NOT_FOUND", "That verification record could not be found.");
    }
    return jsonOk({ verification });
  } catch (error) {
    return jsonError(error);
  }
}

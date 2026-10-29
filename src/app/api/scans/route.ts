import { ApiError, ensureString, jsonError, jsonOk, readJsonBody } from "@/server/http/errors";
import { clientKey, enforceRateLimit } from "@/server/http/rate-limit";
import { createDemoScan, createLiveScan, toScanDetail } from "@/server/services/scan-service";
import { isValidProgressId } from "@/server/services/scan-progress";
import { listStoredScans } from "@/server/store/scan-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scans = await listStoredScans(20);
    return jsonOk({ scans, count: scans.length });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, { scope: "scan", limit: 12, windowMs: 60_000 });
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiError("INVALID_INPUT", "Request body must be a JSON object.");
    }
    const payload = body as Record<string, unknown>;
    const requestedMode = typeof payload.mode === "string" ? payload.mode : undefined;
    const demoId = typeof payload.demoId === "string" ? payload.demoId.trim() : undefined;
    const repository = typeof payload.repository === "string" ? payload.repository.trim() : undefined;
    const mode = requestedMode ?? (demoId ? "demo" : repository ? "live" : undefined);

    if (mode !== "demo" && mode !== "live") {
      throw new ApiError("INVALID_INPUT", 'Provide either "demoId" or "repository" (or an explicit mode).');
    }

    // Optional client-generated id so the UI can follow the real server-side
    // lifecycle. Without it the scan still works; the UI just shows "working".
    const progressId = isValidProgressId(payload.progressId) ? payload.progressId : undefined;
    const started = Date.now();
    const assessment =
      mode === "demo"
        ? await createDemoScan(ensureString(demoId, "demoId", { max: 64 }), progressId)
        : await createLiveScan(ensureString(repository, "repository", { max: 300 }), progressId);

    return jsonOk(
      {
        scan: toScanDetail(assessment),
        meta: {
          durationMs: Date.now() - started,
          storage: assessment.storage,
          accessMode: mode === "live" ? (process.env.GITHUB_TOKEN ? "authenticated" : "anonymous") : "fixture",
          requestOrigin: clientKey(request).slice(0, 12),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

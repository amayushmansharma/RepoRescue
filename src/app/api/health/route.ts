import { databaseReachable } from "@/server/store/scan-store";
import { githubAccessMode } from "@/server/services/scan-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = await databaseReachable();
  const body = {
    ok: true,
    service: "reborescue",
    time: new Date().toISOString(),
    checks: {
      database: database ? "reachable" : "unavailable (scans fall back to in-process storage)",
      githubToken: githubAccessMode() === "authenticated" ? "configured (server-side only)" : "not configured (public, anonymous GitHub access)",
      llm: "not used: findings come from deterministic rules",
      reviewExport: "available (server-generated ZIP; no GitHub write)",
      remoteWrites: "disabled",
    },
  };
  // The health contract stays green when the database is degraded so the app can
  // still serve the demo workflow, but the response states the real condition.
  return Response.json(body, { status: 200 });
}

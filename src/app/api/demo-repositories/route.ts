import { DEMO_REPOSITORIES } from "@/server/demo/fixtures";
import { jsonError, jsonOk } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({
      repositories: DEMO_REPOSITORIES,
      note: "Bundled deterministic fixtures. They exercise the same analysis engine as a live scan and require no GitHub credentials.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

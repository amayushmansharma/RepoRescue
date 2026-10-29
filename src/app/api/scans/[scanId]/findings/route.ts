import { jsonError, jsonOk } from "@/server/http/errors";
import { filterFindings } from "@/server/services/findings-service";
import { loadAssessment } from "@/server/services/remediation-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ scanId: string }> }) {
  try {
    const { scanId } = await context.params;
    const assessment = await loadAssessment(scanId);
    const url = new URL(request.url);
    const findings = filterFindings(assessment.findings, {
      severity: url.searchParams.get("severity"),
      category: url.searchParams.get("category"),
      q: url.searchParams.get("q"),
      sort: url.searchParams.get("sort"),
      fixable: url.searchParams.get("fixable"),
    });
    return jsonOk({
      scanId,
      repository: assessment.repository.fullName,
      mode: assessment.mode,
      total: assessment.findings.length,
      returned: findings.length,
      findings,
    });
  } catch (error) {
    return jsonError(error);
  }
}

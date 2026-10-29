import { SEVERITIES, type Finding, type FindingCategory, type Severity } from "@/lib/types";

export type FindingQuery = {
  severity?: string | null;
  category?: string | null;
  q?: string | null;
  sort?: string | null;
  fixable?: string | null;
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const EFFORT_ORDER = { small: 0, medium: 1, large: 2 } as const;

export function filterFindings(findings: Finding[], query: FindingQuery): Finding[] {
  const severityFilter =
    query.severity && query.severity !== "all" && SEVERITIES.includes(query.severity as Severity) ? (query.severity as Severity) : null;
  const categoryFilter = query.category && query.category !== "all" ? (query.category as FindingCategory) : null;
  const search = query.q?.trim().toLowerCase() ?? "";
  const sort = query.sort ?? "severity";

  const filtered = findings.filter((finding) => {
    if (severityFilter && finding.severity !== severityFilter) return false;
    if (categoryFilter && finding.category !== categoryFilter) return false;
    if (query.fixable === "true" && finding.remediation.kind !== "auto") return false;
    if (search) {
      const haystack = [
        finding.title,
        finding.summary,
        finding.whyItMatters,
        finding.ruleId,
        finding.category,
        finding.location?.path ?? "",
        ...finding.evidence.map((evidence) => evidence.path ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    if (sort === "rule") return a.ruleId.localeCompare(b.ruleId);
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "effort") return EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId);
  });
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABELS, DIMENSION_LABELS } from "../../../shared/constants.js";
import { useScanWorkspace } from "../state/ScanWorkspaceProvider.jsx";
import { ConfidenceBadge, Notice, SeverityBadge, titleCase } from "../components/ui.jsx";
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export function FindingsExplorer() {
    const { scan, selected, selectAllAuto, clearSelection, toggle } = useScanWorkspace();
    const [query, setQuery] = useState("");
    const [severity, setSeverity] = useState("all");
    const [category, setCategory] = useState("all");
    const [sort, setSort] = useState("severity");
    const [fixableOnly, setFixableOnly] = useState(false);
    const [expanded, setExpanded] = useState(null);
    const findings = useMemo(() => scan?.findings ?? [], [scan]);
    const categories = useMemo(() => Array.from(new Set(findings.map((finding) => finding.category))).sort(), [findings]);
    const filtered = useMemo(() => {
        const search = query.trim().toLowerCase();
        return findings
            .filter((finding) => {
            if (severity !== "all" && finding.severity !== severity)
                return false;
            if (category !== "all" && finding.category !== category)
                return false;
            if (fixableOnly && finding.remediation.kind !== "auto")
                return false;
            if (!search)
                return true;
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
            return haystack.includes(search);
        })
            .sort((a, b) => {
            if (sort === "rule")
                return a.ruleId.localeCompare(b.ruleId);
            if (sort === "title")
                return a.title.localeCompare(b.title);
            if (sort === "effort") {
                const effort = { small: 0, medium: 1, large: 2 };
                return effort[a.effort] - effort[b.effort] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
            }
            return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId);
        });
    }, [findings, query, severity, category, sort, fixableOnly]);
    if (!scan)
        return null;
    return (<div className="grid gap-5">
      <section className="glass panel" aria-labelledby="findings-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Stage 02 · find</span>
            <h1 id="findings-title" style={{ fontSize: "1.35rem", marginTop: 8 }}>
              Findings you can reproduce
            </h1>
            <p className="muted" style={{ fontSize: 13.2, marginTop: 6, maxWidth: 620 }}>
              {scan.summary.totalFindings} findings from {scan.ecosystem.label} evidence. Expand a finding for the affected
              file, line evidence, remediation route and confidence. {scan.summary.autoFixable} support a safe patch now.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="badge badge-mono">{selected.length} selected for fix</span>
            <Link className="btn btn-ghost btn-sm" to={`/scan/${scan.scanId}`}>
              ← Scan summary
            </Link>
          </div>
        </div>

        <div className="subtle panel-tight" style={{ marginTop: 16 }}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.8fr))]">
            <div>
              <label className="field-label" htmlFor="finding-search">
                Search findings
              </label>
              <input id="finding-search" className="input" type="search" placeholder="title, evidence, path, rule id…" value={query} onChange={(event) => setQuery(event.target.value)} style={{ minHeight: 36, fontSize: 13 }}/>
            </div>
            <div>
              <label className="field-label" htmlFor="severity-filter">
                Severity
              </label>
              <select id="severity-filter" className="select w-full" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="all">All severities</option>
                {["critical", "high", "medium", "low", "info"].map((value) => (<option key={value} value={value}>
                    {titleCase(value)} ({scan.summary.bySeverity[value]})
                  </option>))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="category-filter">
                Category
              </label>
              <select id="category-filter" className="select w-full" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">All categories</option>
                {categories.map((value) => (<option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="sort-select">
                Sort by
              </label>
              <select id="sort-select" className="select w-full" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="severity">Severity</option>
                <option value="rule">Rule id</option>
                <option value="title">Title</option>
                <option value="effort">Effort</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 12 }}>
            <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              <input type="checkbox" checked={fixableOnly} onChange={(event) => setFixableOnly(event.target.checked)}/>
              Only findings with a safe automatic patch
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllAuto}>
                Select all auto-fixable
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={selected.length === 0}>
                Clear selection
              </button>
            </div>
          </div>
        </div>

        <p aria-live="polite" className="dim" style={{ fontSize: 12, marginTop: 12 }}>
          Showing {filtered.length} of {findings.length} findings.
        </p>

        {filtered.length === 0 ? (<div style={{ marginTop: 14 }}>
            <Notice tone="info" title="No findings match these filters">
              Clear the search or widen the filters. Findings are only produced by rules with supporting evidence, so an
              empty list can be legitimate for a healthy repository.
            </Notice>
          </div>) : (<div className="grid gap-3" style={{ marginTop: 12 }}>
            {filtered.map((finding) => (<FindingCard key={finding.id} finding={finding} expanded={expanded === finding.id} onToggleExpand={() => setExpanded(expanded === finding.id ? null : finding.id)} selected={selected.includes(finding.id)} onToggleSelect={() => toggle(finding.id)}/>))}
          </div>)}

        <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 18 }}>
          <p className="dim" style={{ fontSize: 12 }}>
            Selection carries into FIX. Nothing is generated until you open that stage.
          </p>
          <div className="btn-row">
            <Link className="btn btn-ghost" to={`/scan/${scan.scanId}`}>
              Back to summary
            </Link>
{selected.length === 0 ? (
              <button className="btn btn-primary" type="button" disabled title="Select at least one finding to continue">
                Continue to FIX (0 selected) →
              </button>
            ) : (
              <Link className="btn btn-primary" to={`/scan/${scan.scanId}/fix`}>
                Continue to FIX ({selected.length} selected) →
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>);
}
function FindingCard({ finding, expanded, onToggleExpand, selected, onToggleSelect, }) {
    const detailId = `finding-detail-${finding.id}`;
    return (<article className="finding" data-selected={selected ? "true" : "false"}>
      <div className="flex items-start gap-2">
        <button type="button" className="finding-head" onClick={onToggleExpand} aria-expanded={expanded} aria-controls={detailId}>
          <span aria-hidden="true" className="mono" style={{ color: "var(--text-dim)", fontSize: 12, paddingTop: 2 }}>
            {expanded ? "▾" : "▸"}
          </span>
          <span style={{ flex: 1 }}>
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity}/>
              <span className="badge badge-mono">{finding.ruleId}</span>
              <span className="badge">{CATEGORY_LABELS[finding.category]}</span>
              <span className={`badge badge-mono ${finding.remediation.kind === "auto" ? "badge-pass" : ""}`}>
                {finding.remediation.kind === "auto" ? "safe patch" : "manual"}
              </span>
              {finding.beginnerSuitable ? <span className="badge badge-mono">beginner ok</span> : null}
            </span>
            <span className="finding-title" style={{ display: "block", marginTop: 8 }}>
              {finding.title}
            </span>
            <span className="muted" style={{ display: "block", fontSize: 12.8, marginTop: 4, lineHeight: 1.55 }}>
              {finding.summary}
            </span>
            {finding.location ? (<span className="mono dim" style={{ display: "block", fontSize: 11.4, marginTop: 6 }}>
                {finding.location.path}
                {finding.location.startLine ? `:${finding.location.startLine}` : ""}
              </span>) : null}
          </span>
        </button>
        <div style={{ padding: "10px 12px 0 0" }}>
          <button type="button" className={`btn btn-sm ${selected ? "btn-primary" : "btn-ghost"}`} onClick={onToggleSelect} aria-pressed={selected}>
            {selected ? "Selected" : "Add to fix"}
          </button>
        </div>
      </div>

      {expanded ? (<div className="finding-detail" id={detailId}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Why it matters
              </h4>
              <p className="muted" style={{ fontSize: 12.9, lineHeight: 1.65, marginTop: 6 }}>
                {finding.whyItMatters}
              </p>
              <h4 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 14 }}>
                Recommended remediation
              </h4>
              <p className="muted" style={{ fontSize: 12.9, lineHeight: 1.65, marginTop: 6 }}>
                {finding.recommendation}
              </p>
              {finding.remediation.steps ? (<ol className="muted" style={{ fontSize: 12.6, lineHeight: 1.65, marginTop: 8, paddingLeft: 18 }}>
                  {finding.remediation.steps.map((step) => (<li key={step}>{step}</li>))}
                </ol>) : null}
            </div>
            <div>
              <h4 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Evidence ({finding.evidence.length})
              </h4>
              <div className="grid gap-2" style={{ marginTop: 6 }}>
                {finding.evidence.map((evidence, index) => (<div key={`${evidence.label}-${index}`}>
                    <p style={{ fontSize: 12.5, color: "var(--text)" }}>{evidence.label}</p>
                    {evidence.path ? (<p className="mono dim" style={{ fontSize: 11 }}>
                        {evidence.path}
                        {evidence.startLine ? `:${evidence.startLine}` : ""}
                        {evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}
                      </p>) : null}
                    {evidence.excerpt ? <pre className="evidence" style={{ marginTop: 5 }}>{evidence.excerpt}</pre> : null}
                    {evidence.note ? (<p className="dim" style={{ fontSize: 11.8, marginTop: 4, lineHeight: 1.55 }}>
                        {evidence.note}
                      </p>) : null}
                  </div>))}
              </div>
            </div>
          </div>

          <div className="divider" style={{ margin: "14px 0" }}/>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Confidence" value={<ConfidenceBadge confidence={finding.confidence}/>}/>
            <Meta label="Dimension" value={<span style={{ fontSize: 12.5 }}>{DIMENSION_LABELS[finding.dimension]}</span>}/>
            <Meta label="Effort" value={<span style={{ fontSize: 12.5 }}>{titleCase(finding.effort)}</span>}/>
            <Meta label="Beginner suitable" value={<span style={{ fontSize: 12.5 }}>{finding.beginnerSuitable ? "Yes (defensible)" : "Not recommended"}</span>}/>
          </div>
          <div className="subtle panel-tight" style={{ marginTop: 12 }}>
            <p className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>
              VALIDATION METHOD
            </p>
            <p className="muted" style={{ fontSize: 12.6, marginTop: 5 }}>
              {finding.validationMethod}
            </p>
          </div>
        </div>) : null}
    </article>);
}
function Meta({ label, value }) {
    return (<div>
      <p className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </p>
      <div style={{ marginTop: 5 }}>{value}</div>
    </div>);
}

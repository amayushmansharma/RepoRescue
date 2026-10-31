import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABELS, DIMENSION_LABELS } from "../../../shared/constants.js";
import { useScanWorkspace } from "../state/ScanWorkspaceProvider.jsx";
import { ConfidenceBadge, Notice, SeverityBadge, Spinner, titleCase } from "../components/ui.jsx";
import { api, ApiClientError } from "../services/api-client.js";
import { getSimpleExplanation } from "../data/finding-explanations.js";
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export function FindingsExplorer() {
    const { scan, selected, selectAllAuto, clearSelection, toggle } = useScanWorkspace();
    const [activeTab, setActiveTab] = useState("findings");
    const [opportunities, setOpportunities] = useState(null);
    const loadingOpportunities = opportunities === null;
    const [oppDifficulty, setOppDifficulty] = useState("all");
    const [oppPriority, setOppPriority] = useState("all");
    const [oppBeginnerOnly, setOppBeginnerOnly] = useState(false);
    const [oppFixableOnly, setOppFixableOnly] = useState(false);

    useEffect(() => {
      if (!scan?.scanId) return;
      let active = true;
      api.getOpportunities(scan.scanId)
        .then((res) => {
          if (active) setOpportunities(res.opportunities);
        })
        .catch(() => {
          if (active) setOpportunities([]);
        });
      return () => {
        active = false;
      };
    }, [scan?.scanId]);

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

    const filteredOpportunities = useMemo(() => {
      if (!opportunities) return [];
      const search = query.trim().toLowerCase();
      return opportunities.filter((opp) => {
        if (oppDifficulty !== "all" && opp.difficulty !== oppDifficulty) return false;
        if (oppPriority !== "all" && opp.priority !== oppPriority) return false;
        if (oppBeginnerOnly && !opp.beginnerSuitable) return false;
        if (oppFixableOnly && !opp.fixable) return false;
        if (!search) return true;
        const haystack = [opp.title, opp.summary, opp.whyItMatters, opp.category, ...opp.relevantFiles].join(" ").toLowerCase();
        return haystack.includes(search);
      });
    }, [opportunities, oppDifficulty, oppPriority, oppBeginnerOnly, oppFixableOnly, query]);

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

        <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 14 }}>
          <div className="flex items-center gap-2" role="tablist" aria-label="Finding and opportunity views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "findings"}
              className={`btn btn-sm ${activeTab === "findings" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setActiveTab("findings")}
            >
              All Findings ({findings.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "opportunities"}
              className={`btn btn-sm ${activeTab === "opportunities" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setActiveTab("opportunities")}
            >
              ✦ Contribution Opportunities ({opportunities ? opportunities.length : "…"})
            </button>
          </div>
        </div>

        {activeTab === "opportunities" ? (
          <div>
            <div className="subtle panel-tight" style={{ marginTop: 16 }}>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,0.8fr))]">
                <div>
                  <label className="field-label" htmlFor="opp-search">
                    Search opportunities
                  </label>
                  <input
                    id="opp-search"
                    className="input"
                    type="search"
                    placeholder="title, files, impact, category…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    style={{ minHeight: 36, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="opp-difficulty-filter">
                    Difficulty
                  </label>
                  <select
                    id="opp-difficulty-filter"
                    className="select w-full"
                    value={oppDifficulty}
                    onChange={(event) => setOppDifficulty(event.target.value)}
                  >
                    <option value="all">All difficulties</option>
                    <option value="easy">Easy (Good first issue)</option>
                    <option value="medium">Medium</option>
                    <option value="involved">Involved</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="opp-priority-filter">
                    Priority
                  </label>
                  <select
                    id="opp-priority-filter"
                    className="select w-full"
                    value={oppPriority}
                    onChange={(event) => setOppPriority(event.target.value)}
                  >
                    <option value="all">All priorities</option>
                    <option value="high">High priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="low">Low priority</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 12 }}>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    <input
                      type="checkbox"
                      checked={oppBeginnerOnly}
                      onChange={(event) => setOppBeginnerOnly(event.target.checked)}
                    />
                    Beginner-friendly only
                  </label>
                  <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    <input
                      type="checkbox"
                      checked={oppFixableOnly}
                      onChange={(event) => setOppFixableOnly(event.target.checked)}
                    />
                    Safe automated patch available
                  </label>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllAuto}>
                    Select all auto-fixable
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearSelection}
                    disabled={selected.length === 0}
                  >
                    Clear selection
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginTop: 12 }}>
              <p aria-live="polite" className="dim" style={{ fontSize: 12 }}>
                Showing {filteredOpportunities.length} of {opportunities ? opportunities.length : "…"} opportunities derived from scanner evidence.
              </p>
              <span className="mono dim" style={{ fontSize: 11 }}>
                Prioritized by readiness impact & beginner suitability · Not official GitHub issues
              </span>
            </div>

            {loadingOpportunities && !opportunities ? (
              <div style={{ marginTop: 24, textAlign: "center" }}>
                <Spinner label="Deriving contribution opportunities from scan evidence..." />
              </div>
            ) : filteredOpportunities.length === 0 ? (
              <div style={{ marginTop: 14 }}>
                <Notice tone="info" title="No opportunities match your filters">
                  Clear the search or widen the difficulty and priority filters to explore more opportunities.
                </Notice>
              </div>
            ) : (
              <div className="grid gap-3" style={{ marginTop: 12 }}>
                {filteredOpportunities.map((opportunity) => (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
                    scanId={scan.scanId}
                    selected={selected.includes(opportunity.sourceFindingId)}
                    onToggleSelect={() => toggle(opportunity.sourceFindingId)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
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
                {filtered.map((finding) => (<FindingCard key={finding.id} finding={finding} scanId={scan.scanId} expanded={expanded === finding.id} onToggleExpand={() => setExpanded(expanded === finding.id ? null : finding.id)} selected={selected.includes(finding.id)} onToggleSelect={() => toggle(finding.id)}/>))}
              </div>)}
          </div>
        )}

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

function OpportunityCard({ opportunity, scanId, selected, onToggleSelect }) {
  const [showDetails, setShowDetails] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState(null);

  async function requestExplanation() {
    if (loadingExplanation || explanation) return;
    setLoadingExplanation(true);
    setExplanationError(null);
    try {
      const res = await api.explainFinding(scanId, opportunity.sourceFindingId);
      setExplanation(res.explanation);
      setShowDetails(true);
    } catch (err) {
      setExplanationError(err instanceof ApiClientError ? err.message : "Explanation unavailable.");
    } finally {
      setLoadingExplanation(false);
    }
  }

  const priorityColor =
    opportunity.priority === "high"
      ? "badge-rose"
      : opportunity.priority === "medium"
      ? "badge-medium"
      : "badge-mono";

  return (
    <article className="finding" data-selected={selected ? "true" : "false"} data-priority={opportunity.priority} style={{ padding: 14 }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-mono">Scanner Opportunity</span>
            <span className={`badge ${priorityColor}`}>Priority: {opportunity.priority}</span>
            <span className="badge badge-mono">Difficulty: {opportunity.difficulty}</span>
            {opportunity.beginnerSuitable ? (
              <span className="badge badge-pass badge-mono">★ Beginner Friendly</span>
            ) : null}
            <span className={`badge badge-mono ${opportunity.fixable ? "badge-pass" : ""}`}>
              {opportunity.fixable ? "Safe patch available" : "Manual contribution"}
            </span>
          </div>

          <h3 style={{ fontSize: "1.08rem", marginTop: 8, fontWeight: 600 }}>
            {opportunity.title}
          </h3>

          <p className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>
            {opportunity.summary}
          </p>

          <div style={{ marginTop: 8, fontSize: 12.5 }}>
            <span className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>POTENTIAL IMPACT:</span>{" "}
            <span style={{ color: "var(--text)" }}>{opportunity.impact}</span>
          </div>

          {opportunity.relevantFiles && opportunity.relevantFiles.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 8 }}>
              <span className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>FILES:</span>
              {opportunity.relevantFiles.map((file) => (
                <span key={file} className="code-inline" style={{ fontSize: 11.5 }}>
                  {file}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            className={`btn btn-sm ${selected ? "btn-primary" : "btn-ghost"}`}
            onClick={onToggleSelect}
            aria-pressed={selected}
          >
            {selected ? "Selected for fix" : "Add to fix"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowDetails(!showDetails)}
            style={{ fontSize: 12 }}
          >
            {showDetails ? "Hide guidance ▴" : "View guidance ▾"}
          </button>
        </div>
      </div>

      {showDetails ? (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h4 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Why this matters for open source
              </h4>
              <p className="muted" style={{ fontSize: 12.8, marginTop: 4, lineHeight: 1.6 }}>
                {opportunity.whyItMatters}
              </p>
            </div>
            <div>
              <h4 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Suggested Next Action
              </h4>
              <p className="muted" style={{ fontSize: 12.8, marginTop: 4, lineHeight: 1.6 }}>
                {opportunity.suggestedAction}
              </p>
              {opportunity.steps && opportunity.steps.length > 1 ? (
                <ol className="muted" style={{ fontSize: 12.5, marginTop: 6, paddingLeft: 18, lineHeight: 1.6 }}>
                  {opportunity.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginTop: 12 }}>
            <span className="mono dim" style={{ fontSize: 11 }}>
              Derived from scanner finding: {opportunity.ruleId} ({opportunity.originalFindingTitle}). Not an official GitHub issue.
            </span>
            {!explanation && !loadingExplanation ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={requestExplanation}
                style={{ fontSize: 11.5 }}
              >
                ✦ Explain with AI
              </button>
            ) : null}
          </div>

          {loadingExplanation ? (
            <div style={{ marginTop: 10 }}>
              <Spinner label="Analyzing opportunity with Gemini Flash..." />
            </div>
          ) : null}

          {explanationError ? (
            <div style={{ marginTop: 8 }}>
              <Notice tone="warn" title="Explanation unavailable">{explanationError}</Notice>
            </div>
          ) : null}

          {explanation ? (
            <div className="subtle panel-tight" style={{ marginTop: 10 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <span className="mono dim" style={{ fontSize: 10.5, textTransform: "uppercase" }}>AI Explanation</span>
                <span className={`badge badge-mono ${explanation.source === "ai" ? "badge-pass" : ""}`}>
                  {explanation.source === "ai" ? `✦ AI (${explanation.model ?? "Gemini Flash"})` : "deterministic"}
                </span>
              </div>
              <div style={{ fontSize: 12.6, lineHeight: 1.65, whiteSpace: "pre-line" }}>
                {explanation.text}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function FindingCard({ finding, scanId, expanded, onToggleExpand, selected, onToggleSelect, }) {
    const detailId = `finding-detail-${finding.id}`;
    const simple = getSimpleExplanation(finding.ruleId);
    const [explanation, setExplanation] = useState(null);
    const [loadingExplanation, setLoadingExplanation] = useState(false);
    const [explanationError, setExplanationError] = useState(null);

    async function requestExplanation() {
      if (loadingExplanation || explanation) return;
      setLoadingExplanation(true);
      setExplanationError(null);
      try {
        const res = await api.explainFinding(scanId, finding.id);
        setExplanation(res.explanation);
      } catch (err) {
        setExplanationError(err instanceof ApiClientError ? err.message : "The explanation could not be generated.");
      } finally {
        setLoadingExplanation(false);
      }
    }

    return (<article className="finding" data-selected={selected ? "true" : "false"} data-severity={finding.severity}>
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
            {simple ? (
              <span className="simple-explainer">
                <span className="simple-explainer-header">
                  <span aria-hidden="true">💡</span>
                  <span>In simple words</span>
                </span>
                <span className="simple-explainer-meaning">
                  {simple.meaning}
                </span>
                <span className="simple-explainer-impact">
                  <strong>Why it matters:</strong> {simple.whyItMatters}
                </span>
              </span>
            ) : null}
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

          <div className="subtle panel-tight" style={{ marginTop: 12 }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Contextual AI Explanation
                </span>
                {explanation ? (
                  <span className={`badge badge-mono ${explanation.source === "ai" ? "badge-pass" : ""}`}>
                    {explanation.source === "ai" ? `✦ AI (${explanation.model ?? "Gemini Flash"})` : "deterministic analysis"}
                  </span>
                ) : null}
                {explanation?.rateLimited ? (
                  <span className="badge badge-warn badge-mono">Rate limited (fallback active)</span>
                ) : null}
              </div>
              {!explanation && !loadingExplanation ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={requestExplanation}
                  style={{ fontSize: 12 }}
                >
                  ✦ Explain with AI
                </button>
              ) : null}
            </div>

            {loadingExplanation ? (
              <div style={{ marginTop: 10, padding: "8px 0" }}>
                <Spinner label="Analyzing repository evidence with Gemini Flash..." />
              </div>
            ) : null}

            {explanationError ? (
              <div style={{ marginTop: 10 }}>
                <Notice tone="warn" title="Could not load explanation">
                  <p style={{ fontSize: 12.5 }}>{explanationError}</p>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={requestExplanation} style={{ marginTop: 6 }}>
                    Retry
                  </button>
                </Notice>
              </div>
            ) : null}

            {explanation ? (
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 12.8, lineHeight: 1.65, whiteSpace: "pre-line", color: "var(--text)" }}
                >
                  {explanation.text}
                </div>
                <p className="dim" style={{ fontSize: 11, marginTop: 10, borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: 6 }}>
                  Grounded strictly in scanned repository evidence. Never executes repository code or performs remote writes.
                </p>
              </div>
            ) : !loadingExplanation && !explanationError ? (
              <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                Generate an evidence-grounded explanation of what was found, why maintainers care, and the concrete steps to take.
              </p>
            ) : null}
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

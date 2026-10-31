import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DIMENSION_LABELS } from "../../../shared/constants.js";
import { ApiClientError, api } from "../services/api-client.js";
import { useScanWorkspace } from "../state/ScanWorkspaceProvider.jsx";
import { Meter, Notice, ScoreRing, SeverityBadge, Spinner, StatusRow, formatUtc, titleCase } from "../components/ui.jsx";
export function ScanSummary() {
    const { scan } = useScanWorkspace();
    const navigate = useNavigate();
    const [expandedDimension, setExpandedDimension] = useState("documentation");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    if (!scan)
        return null;
    const severityEntries = ["critical", "high", "medium", "low", "info"].filter((severity) => scan.summary.bySeverity[severity] > 0);
    async function runRescan() {
        setBusy(true);
        setError(null);
        try {
            const result = await api.rescan(scan.scanId);
            // A re-scan is a new assessment with fresh evidence: open that record.
            navigate(`/scan/${result.scan.scanId}`);
        }
        catch (caught) {
            setError(caught instanceof ApiClientError ? caught.message : "The re-scan could not be completed.");
        }
        finally {
            setBusy(false);
        }
    }
    return (<div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="glass panel" aria-labelledby="assessment-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="eyebrow">Stage 01 · scan assessment</span>
              <h1 id="assessment-title" style={{ fontSize: "1.45rem", marginTop: 8 }}>
                {scan.repository.fullName}
              </h1>
              <p className="muted" style={{ fontSize: 13.2, marginTop: 6, maxWidth: 520 }}>
                {scan.repository.description ?? "No repository description."}
              </p>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
                <span className="badge badge-mono">{scan.status}</span>
                <span className="badge badge-mono">{scan.ecosystem.label}</span>
                {scan.ecosystem.primaryLanguage ? <span className="badge badge-mono">{scan.ecosystem.primaryLanguage}</span> : null}
                <span className="badge badge-mono">{scan.repository.stars} stars (metadata)</span>
              </div>
            </div>
            <ScoreRing score={scan.score.total} coverage={scan.score.coverage}/>
          </div>

          <div className="divider" style={{ margin: "18px 0" }}/>

          <div className="grid gap-x-6 gap-y-0 sm:grid-cols-2" role="group" aria-label="Scan details">
            <div>
              <StatusRow label="Scan id">
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {scan.scanId}
                </span>
              </StatusRow>
              <StatusRow label="Scanned">
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {formatUtc(scan.createdAt)}
                </span>
              </StatusRow>
              <StatusRow label="Mode">
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {scan.mode === "demo" ? "DEMO fixture" : "LIVE GitHub scan"}
                </span>
              </StatusRow>
            </div>
            <div>
              <StatusRow label="Files analysed">
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {scan.snapshot.fileCount} with content · {scan.snapshot.treeCount} listed
                </span>
              </StatusRow>
              <StatusRow label="Evidence captured">
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {formatUtc(scan.snapshot.fetchedAt)}
                </span>
              </StatusRow>
              <StatusRow label="Default branch">
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {scan.repository.defaultBranch}
                </span>
              </StatusRow>
            </div>
          </div>

          <div className="stat-grid" style={{ marginTop: 18 }}>
            <div className="stat">
              <div className="stat-value">{scan.summary.totalFindings}</div>
              <div className="stat-label">findings</div>
            </div>
            <div className="stat">
              <div className="stat-value" style={{ color: "var(--mint)" }}>
                {scan.summary.autoFixable}
              </div>
              <div className="stat-label">with safe patches</div>
            </div>
            <div className="stat">
              <div className="stat-value" style={{ color: "var(--amber)" }}>
                {scan.summary.manualOnly}
              </div>
              <div className="stat-label">need a human</div>
            </div>
            <div className="stat">
              <div className="stat-value">{scan.summary.beginnerFriendly}</div>
              <div className="stat-label">beginner-suitable</div>
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 18 }}>
            <Link className="btn btn-primary" to={`/scan/${scan.scanId}/findings`}>
              Review {scan.summary.totalFindings} findings →
            </Link>
            <Link className="btn btn-ghost" to={`/scan/${scan.scanId}/fix`}>
              Go straight to fixes
            </Link>
            <button type="button" className="btn btn-ghost" onClick={runRescan} disabled={busy}>
              {busy ? "Re-scanning…" : "Re-scan repository"}
            </button>
          </div>
          {busy ? <div style={{ marginTop: 10 }}><Spinner label="Fetching fresh evidence and re-evaluating rules"/></div> : null}
          {error ? (<div style={{ marginTop: 12 }}>
              <Notice tone="error" title="Re-scan failed">
                {error}
              </Notice>
            </div>) : null}
        </section>

        <aside className="grid gap-5" aria-label="Severity distribution and next steps">
          <section className="glass panel">
            <h2 className="section-title" style={{ fontSize: "1rem" }}>
              Severity distribution
            </h2>
            {severityEntries.length === 0 ? (<p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                No findings were produced by the implemented rules for this repository.
              </p>) : (<ul className="clean-list" style={{ marginTop: 12 }}>
                {severityEntries.map((severity) => (<li key={severity} style={{ alignItems: "center" }}>
                    <SeverityBadge severity={severity}/>
                    <span style={{ flex: 1 }}>
                      <Meter value={(scan.summary.bySeverity[severity] / Math.max(1, scan.summary.totalFindings)) * 100} tone={severity === "high" || severity === "critical" ? "bad" : undefined}/>
                    </span>
                    <span className="mono" style={{ fontSize: 12, minWidth: 18, textAlign: "right" }}>
                      {scan.summary.bySeverity[severity]}
                    </span>
                  </li>))}
              </ul>)}
            <p className="dim" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.6 }}>
              Severity reflects contribution impact, not security risk. Documentation gaps are never labelled critical.
            </p>
          </section>

          <section className="glass panel">
            <h2 className="section-title" style={{ fontSize: "1rem" }}>
              Next steps
            </h2>
            <ul className="clean-list" style={{ marginTop: 12 }}>
              {scan.nextSteps.map((step) => (<li key={step}>
                  <span className="bullet bullet-mint" aria-hidden="true"/>
                  <span>{step}</span>
                </li>))}
            </ul>
          </section>
        </aside>
      </div>

      <section className="glass panel" aria-labelledby="score-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="score-title" className="section-title">
              Readiness score breakdown
            </h2>
            <p className="muted" style={{ fontSize: 12.8, marginTop: 6 }}>
              {scan.score.total}/100 · coverage {scan.score.coverage} of 100 documented weight points. Every deduction is traceable to a check.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/methodology">
            Formula & weights
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2" style={{ marginTop: 16 }}>
          {scan.score.dimensions.map((dimension) => (<div key={dimension.id} className="subtle panel-tight">
              <div className="flex items-center justify-between gap-3">
                <h3 style={{ fontSize: "0.9rem" }}>{DIMENSION_LABELS[dimension.id]}</h3>
                <span className="mono" style={{ fontSize: 12.5 }}>
                  {dimension.score === null ? "n/a" : `${dimension.score}`}
                  <span className="dim"> · weight {dimension.weight}</span>
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                <Meter value={dimension.score ?? 0} tone={(dimension.score ?? 100) < 60 ? "bad" : (dimension.score ?? 100) < 85 ? "warn" : undefined}/>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setExpandedDimension(expandedDimension === dimension.id ? null : dimension.id)} aria-expanded={expandedDimension === dimension.id}>
                {expandedDimension === dimension.id ? "Hide checks" : `Show ${dimension.checks.length} checks`}
              </button>
              {expandedDimension === dimension.id ? (<ul className="clean-list" style={{ marginTop: 10 }}>
                  {dimension.checks.map((check) => (<li key={check.id} style={{ alignItems: "flex-start" }}>
                      <span aria-hidden="true" className="mono" style={{ color: check.status === "pass" ? "var(--mint)" : check.status === "not-applicable" ? "var(--text-dim)" : "var(--rose)", width: 18, flex: "0 0 18px" }}>
                        {check.status === "pass" ? "✓" : check.status === "partial" ? "~" : check.status === "fail" ? "✕" : "–"}
                      </span>
                      <span>
                        <span style={{ color: "var(--text)", fontSize: 12.8 }}>
                          {check.id} · {check.label}
                        </span>{" "}
                        <span className="dim mono" style={{ fontSize: 11 }}>
                          {check.earned}/{check.weight}
                        </span>
                        <span className="dim" style={{ display: "block", fontSize: 11.8, lineHeight: 1.55 }}>
                          {check.evidence}
                        </span>
                      </span>
                    </li>))}
                </ul>) : null}
            </div>))}
        </div>

        {scan.score.deductions.length > 0 ? (<div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: "0.9rem" }}>Largest deductions</h3>
            <div className="scroll-x" tabIndex={0} role="region" aria-label="Score deductions table" style={{ marginTop: 8 }}>
              <table className="table">
                <caption className="sr-only">Checks with the largest score deductions</caption>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Dimension</th>
                    <th scope="col">Points lost</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.score.deductions.map((deduction) => (<tr key={deduction.checkId}>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {deduction.checkId}
                      </td>
                      <td className="muted" style={{ fontSize: 12.5 }}>
                        {titleCase(deduction.dimension)}
                      </td>
                      <td style={{ color: "var(--rose)", fontWeight: 600 }}>{deduction.points}</td>
                      <td className="muted" style={{ fontSize: 12.3 }}>
                        {deduction.reason}
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          </div>) : null}

        {scan.score.limitations.length > 0 ? (
          <details className="disclosure-box" style={{ marginTop: 16 }}>
            <summary className="disclosure-summary">
              <span>Score methodology &amp; limitations ({scan.score.limitations.length})</span>
            </summary>
            <div className="disclosure-content">
              <ul className="clean-list">
                {scan.score.limitations.map((limitation) => (<li key={limitation}>
                    <span className="bullet" aria-hidden="true"/>
                    <span>{limitation}</span>
                  </li>))}
              </ul>
            </div>
          </details>
        ) : null}
      </section>

      <section className="glass panel" aria-labelledby="limitations-title">
        <h2 id="limitations-title" className="section-title">
          Analysis snapshot details
        </h2>
        <div className="subtle panel-tight" style={{ marginTop: 12 }}>
          <p className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>
            FILES WITH CONTENT IN THIS SNAPSHOT
          </p>
          <p className="mono" style={{ fontSize: 11.8, marginTop: 6, lineHeight: 1.7, color: "var(--text-muted)" }}>
            {scan.snapshot.paths.join(" · ")}
            {scan.snapshot.treeCount > scan.snapshot.paths.length ? ` · +${scan.snapshot.treeCount - scan.snapshot.paths.length} more listed` : ""}
          </p>
        </div>
        {scan.limitations.length > 0 ? (
          <details className="disclosure-box" style={{ marginTop: 12 }}>
            <summary className="disclosure-summary">
              <span>Analysis limitations &amp; caveats ({scan.limitations.length})</span>
            </summary>
            <div className="disclosure-content">
              <ul className="clean-list">
                {scan.limitations.map((limitation) => (<li key={limitation}>
                    <span className="bullet" aria-hidden="true"/>
                    <span>{limitation}</span>
                  </li>))}
              </ul>
            </div>
          </details>
        ) : null}
      </section>
    </div>);
}

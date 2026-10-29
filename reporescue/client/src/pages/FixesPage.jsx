import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api-client.js";
import { useWorkspaceResource } from "../state/useWorkspaceResource.js";
import { useScanWorkspace } from "../state/ScanWorkspaceProvider.jsx";
import { DiffView, Notice, SeverityBadge, Spinner, ValidationBadge } from "../components/ui.jsx";
export function FixWorkspace() {
    const { scan, scanId, selected, toggle, selectAllAuto, clearSelection, autoIds } = useScanWorkspace();
    const selectionKey = useMemo(() => [...selected].sort().join(","), [selected]);
    const loadPreview = useCallback(() => api.preview(scanId, selectionKey.split(",")), [scanId, selectionKey]);
    const { data: preview, error, loading, retry } = useWorkspaceResource(
      selectionKey ? `preview:${scanId}:${selectionKey}` : null,
      loadPreview,
      250,
    );
    if (!scan)
        return null;
    const patchProposals = preview?.proposals.filter((proposal) => proposal.kind === "patch") ?? [];
    const manualProposals = preview?.proposals.filter((proposal) => proposal.kind === "manual") ?? [];
    return (<div className="grid gap-5">
      <section className="glass panel" aria-labelledby="fix-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Stage 03 · fix</span>
            <h1 id="fix-title" style={{ fontSize: "1.35rem", marginTop: 8 }}>
              Proposed changes, generated from rules
            </h1>
            <p className="muted" style={{ fontSize: 13.2, marginTop: 6, maxWidth: 660 }}>
              Patches are produced by explicit remediation templates using evidence from this scan. Nothing is applied:
              every file below is a proposal you can review, revise or discard. Findings without a safe automatic change
              are listed with manual instructions instead.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" to={`/scan/${scan.scanId}/findings`}>
            ← Revise in FIND
          </Link>
        </div>

        <div className="stat-grid" style={{ marginTop: 16 }}>
          <div className="stat">
            <div className="stat-value">{selected.length}</div>
            <div className="stat-label">selected</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: "var(--mint)" }}>
              {loading ? "—" : patchProposals.length}
            </div>
            <div className="stat-label">patch proposals</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ color: "var(--amber)" }}>
              {loading ? "—" : manualProposals.length}
            </div>
            <div className="stat-label">manual only</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {loading ? "—" : preview?.totals.files ?? 0}
              <span className="mono dim" style={{ fontSize: 13 }}>
                {" "}
                files
              </span>
            </div>
            <div className="stat-label">
              +{preview?.totals.additions ?? 0} / −{preview?.totals.deletions ?? 0}
            </div>
          </div>
        </div>
      </section>

      <section className="glass panel" aria-labelledby="selection-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="selection-title" className="section-title" style={{ fontSize: "1rem" }}>
            Finding selection
          </h2>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllAuto}>
              Select {autoIds.length} auto-fixable
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={selected.length === 0}>
              Deselect all
            </button>
          </div>
        </div>
        <ul className="clean-list" style={{ marginTop: 12 }}>
          {scan.findings.map((finding) => (<li key={finding.id} style={{ alignItems: "flex-start" }}>
              <input type="checkbox" id={`select-${finding.id}`} checked={selected.includes(finding.id)} onChange={() => toggle(finding.id)} style={{ marginTop: 4 }}/>
              <label htmlFor={`select-${finding.id}`} style={{ cursor: "pointer", flex: 1 }}>
                <span className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={finding.severity}/>
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    {finding.ruleId}
                  </span>
                  <span className={`badge badge-mono ${finding.remediation.kind === "manual" ? "" : "badge-pass"}`}>
                    {finding.remediation.kind === "manual" ? "manual recommendation" : "safe patch available"}
                  </span>
                </span>
                <span style={{ display: "block", color: "var(--text)", fontSize: 13, marginTop: 4 }}>{finding.title}</span>
              </label>
            </li>))}
        </ul>
      </section>

      {selected.length === 0 ? (<Notice tone="info" title="No findings selected">
          Select at least one finding above (or in FIND) to generate a proposed change. RepoRescue will not invent a fix
          for an unselected finding.
        </Notice>) : null}

      {loading ? (<div className="glass panel">
          <Spinner label="Generating and validating proposed patches…"/>
        </div>) : null}

      {error ? (<Notice tone="error" title={error.code ? `Preview failed — ${error.code}` : "Preview failed"}>
           {error.message}
           <div style={{ marginTop: 10 }}>
             <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
               Retry preview
             </button>
           </div>
         </Notice>) : null}

      {preview && !loading ? (<>
          {patchProposals.length === 0 && selected.length > 0 ? (<Notice tone="warn" title="No automatic patches for this selection">
              None of the selected findings has a safe, rule-based remediation. Review the manual recommendations below;
              RepoRescue will not generate a file it cannot justify.
            </Notice>) : null}

          {patchProposals.map((proposal) => (<article className="glass panel" key={proposal.id} aria-labelledby={`proposal-${proposal.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    {proposal.findingId} → {proposal.files.map((file) => file.path).join(", ")}
                  </span>
                  <h2 id={`proposal-${proposal.id}`} style={{ fontSize: "1.02rem", marginTop: 6 }}>
                    {proposal.findingTitle}
                  </h2>
                  <p className="muted" style={{ fontSize: 12.9, marginTop: 5, maxWidth: 700 }}>
                    {proposal.outcome}
                  </p>
                </div>
                <ValidationBadge state={proposal.overallValidation}/>
              </div>

              <div className="grid gap-3" style={{ marginTop: 14 }}>
                {proposal.files.map((file) => (<DiffView key={`${proposal.id}-${file.path}`} path={file.path} diff={file.diff} changeType={file.changeType} additions={file.additions} deletions={file.deletions}/>))}
              </div>

              <div className="grid gap-4 md:grid-cols-2" style={{ marginTop: 16 }}>
                <div>
                  <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Validation ({proposal.validation.length})
                  </h3>
                  <ul className="clean-list" style={{ marginTop: 8 }}>
                    {proposal.validation.map((check) => (<li key={`${proposal.id}-${check.id}-${check.label}`} style={{ alignItems: "flex-start" }}>
                        <ValidationBadge state={check.state}/>
                        <span>
                          <span style={{ color: "var(--text)", fontSize: 12.6 }}>{check.label}</span>
                          <span className="dim" style={{ display: "block", fontSize: 11.8, lineHeight: 1.55 }}>
                            {check.detail}
                          </span>
                        </span>
                      </li>))}
                  </ul>
                </div>
                <div>
                  <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Assumptions & limitations
                  </h3>
                  <ul className="clean-list" style={{ marginTop: 8 }}>
                    {proposal.assumptions.map((assumption) => (<li key={assumption}>
                        <span className="bullet" aria-hidden="true"/>
                        <span>{assumption}</span>
                      </li>))}
                    {proposal.limitations.map((limitation) => (<li key={limitation}>
                        <span className="bullet bullet-rose" aria-hidden="true"/>
                        <span>{limitation}</span>
                      </li>))}
                  </ul>
                  {proposal.instructions.length > 0 ? (<>
                      <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 12 }}>
                        Before submitting
                      </h3>
                      <ol className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 6, paddingLeft: 18 }}>
                        {proposal.instructions.map((instruction) => (<li key={instruction}>{instruction}</li>))}
                      </ol>
                    </>) : null}
                </div>
              </div>
            </article>))}

          {manualProposals.length > 0 ? (<section className="glass panel" aria-labelledby="manual-title">
              <h2 id="manual-title" className="section-title" style={{ fontSize: "1rem" }}>
                Manual recommendations
              </h2>
              <p className="muted" style={{ fontSize: 12.8, marginTop: 6 }}>
                These findings have no safe automatic patch. Each lists the concrete human steps RepoRescue can defend.
              </p>
              <div className="grid gap-3" style={{ marginTop: 12 }}>
                {manualProposals.map((proposal) => {
                    const finding = scan.findings.find((candidate) => candidate.id === proposal.findingId);
                    return (<div className="subtle panel-tight" key={proposal.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        {finding ? <SeverityBadge severity={finding.severity}/> : null}
                        <span className="mono dim" style={{ fontSize: 11 }}>
                          {proposal.findingId}
                        </span>
                        <span className="badge badge-mono">no automatic patch</span>
                      </div>
                      <h3 style={{ fontSize: "0.94rem", marginTop: 6 }}>{proposal.findingTitle}</h3>
                      <p className="muted" style={{ fontSize: 12.7, marginTop: 5 }}>
                        {proposal.outcome}
                      </p>
                      <ol className="muted" style={{ fontSize: 12.4, lineHeight: 1.6, marginTop: 8, paddingLeft: 18 }}>
                        {proposal.instructions.map((instruction) => (<li key={instruction}>{instruction}</li>))}
                      </ol>
                      {proposal.limitations.map((limitation) => (<p className="dim" key={limitation} style={{ fontSize: 11.7, marginTop: 6 }}>
                          {limitation}
                        </p>))}
                    </div>);
                })}
              </div>
            </section>) : null}

          <div className="glass panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 style={{ fontSize: "1rem" }}>Ready for review?</h2>
                <p className="muted" style={{ fontSize: 12.7, marginTop: 5, maxWidth: 620 }}>
                  REVIEW shows every diff, the validation evidence and a PR draft. It still cannot write to GitHub.
                  {preview.totals.validationFailed > 0 ? " Some validators failed — inspect them before continuing." : ""}
                </p>
              </div>
              <div className="btn-row">
                <Link className="btn btn-ghost" to={`/scan/${scan.scanId}/findings`}>
                  Back to findings
                </Link>
{patchProposals.length === 0 ? (
                  <button className="btn btn-primary" type="button" disabled title="Select a finding with a reviewable patch to continue">
                    Continue to REVIEW →
                  </button>
                ) : (
                  <Link className="btn btn-primary" to={`/scan/${scan.scanId}/review`}>
                    Continue to REVIEW →
                  </Link>
                )}
              </div>
            </div>
            <p className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>
              {preview.boundaryNote}
            </p>
          </div>
        </>) : null}
    </div>);
}

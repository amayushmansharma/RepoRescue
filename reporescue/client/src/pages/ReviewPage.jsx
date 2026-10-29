import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiClientError, api } from "../services/api-client.js";
import { useWorkspaceResource } from "../state/useWorkspaceResource.js";
import { useScanWorkspace } from "../state/ScanWorkspaceProvider.jsx";
import { Checklist, DiffView, Notice, Spinner, StatusRow, ValidationBadge } from "../components/ui.jsx";
export function ReviewWorkspace() {
    const { scan, scanId, selected, verificationId, setVerificationId, resources } = useScanWorkspace();
    const navigate = useNavigate();
    const selectionKey = useMemo(() => [...selected].sort().join(","), [selected]);
    const mounted = useRef(false);
    useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; };
    }, []);
    const loadPreview = useCallback(() => api.preview(scanId, selectionKey.split(",")), [scanId, selectionKey]);
    const loadDraft = useCallback(() => api.prPreview(scanId, selectionKey.split(","), verificationId), [scanId, selectionKey, verificationId]);
    const previewState = useWorkspaceResource(selectionKey ? `preview:${scanId}:${selectionKey}` : null, loadPreview);
    const draftState = useWorkspaceResource(selectionKey ? `draft:${scanId}:${selectionKey}:${verificationId ?? ""}` : null, loadDraft);
    const preview = previewState.data;
    const pr = draftState.data;
    const error = previewState.error ?? draftState.error;
    const loading = previewState.loading || draftState.loading;
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState(null);
    const [exporting, setExporting] = useState(false);
    const [reviewNotice, setReviewNotice] = useState(null);
    const [reviewError, setReviewError] = useState(null);
    if (!scan)
        return null;
    async function recordVerification() {
        setVerifying(true);
        setVerifyError(null);
        try {
            const payload = await api.runVerification(scanId, selected);
            resources.prime(`verification:${payload.verification.id}`, payload.verification);
            const currentSelection = setVerificationId(payload.verification.id, selected);
            if (mounted.current && currentSelection) navigate(`/scan/${scanId}/verify`);
        }
        catch (caught) {
            if (mounted.current) setVerifyError(caught instanceof ApiClientError ? caught.message : "Verification could not be recorded.");
        }
        finally {
            if (mounted.current) setVerifying(false);
        }
    }
    async function copyReviewText(label, value) {
        setReviewNotice(null);
        setReviewError(null);
        try {
            if (!navigator.clipboard?.writeText)
                throw new Error("Clipboard access is unavailable in this browser.");
            await navigator.clipboard.writeText(value);
            setReviewNotice(`${label} copied to the clipboard.`);
        }
        catch (caught) {
            setReviewError(caught instanceof Error ? caught.message : `Could not copy the ${label.toLowerCase()}.`);
        }
    }
    async function downloadReviewExport() {
        setExporting(true);
        setReviewNotice(null);
        setReviewError(null);
        try {
            const { blob, filename } = await api.exportReview(scanId, selected);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
            setReviewNotice(`Downloaded ${filename}. It contains proposals only; no GitHub write was performed.`);
        }
        catch (caught) {
            setReviewError(caught instanceof ApiClientError ? caught.message : "The ZIP export could not be created.");
        }
        finally {
            setExporting(false);
        }
    }
    const patchProposals = preview?.proposals.filter((proposal) => proposal.kind === "patch") ?? [];
    const files = patchProposals.flatMap((proposal) => proposal.files.map((file) => ({ ...file, proposalId: proposal.findingId })));
    const uniqueFiles = Array.from(new Map(files.map((file) => [file.path, file])).values());
    return (<div className="grid gap-5">
      <section className="glass panel" aria-labelledby="review-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Stage 04 · review</span>
            <h1 id="review-title" style={{ fontSize: "1.35rem", marginTop: 8 }}>
              Everything before submission
            </h1>
            <p className="muted" style={{ fontSize: 13.2, marginTop: 6, maxWidth: 690 }}>
              This is the complete proposed change: {uniqueFiles.length} file(s), {preview?.totals.additions ?? 0}{" "}
              addition(s), {preview?.totals.deletions ?? 0} deletion(s), validation evidence and a draft pull request.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" to={`/scan/${scan.scanId}/fix`}>
            ← Revise in FIX
          </Link>
        </div>
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn" title="Preview boundary — no GitHub write occurred">
            {pr?.draft.boundaryNote ??
            "RepoRescue prepared this metadata locally. No branch, commit, push or pull request exists."}{" "}
            The PR description below is text you can copy; it is not a live pull request.
          </Notice>
        </div>
      </section>

      {selected.length === 0 ? (<Notice tone="info" title="Nothing selected">
          Return to FIND and select at least one finding before reviewing a change.
        </Notice>) : null}

      {loading ? (<div className="glass panel">
          <Spinner label="Assembling diffs, validation evidence and the pull request draft…"/>
        </div>) : null}

      {error ? (<Notice tone="error" title={error.code ? `Review unavailable — ${error.code}` : "Review unavailable"}>
           {error.message}
           <div style={{ marginTop: 10 }}>
             <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (previewState.error) previewState.retry(); if (draftState.error) draftState.retry(); }}>
               Retry review
             </button>
           </div>
         </Notice>) : null}

      {preview && pr && !loading ? (<>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="glass panel" aria-labelledby="files-title">
              <h2 id="files-title" className="section-title" style={{ fontSize: "1.02rem" }}>
                Changed files ({uniqueFiles.length})
              </h2>
              <div className="scroll-x" tabIndex={0} role="region" aria-label="Proposed files table" style={{ marginTop: 12 }}>
                <table className="table">
                  <caption className="sr-only">Files in the proposed change</caption>
                  <thead>
                    <tr>
                      <th scope="col">Path</th>
                      <th scope="col">Change</th>
                      <th scope="col">Lines</th>
                      <th scope="col">Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueFiles.map((file) => (<tr key={file.path}>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {file.path}
                        </td>
                        <td>
                          <span className="badge badge-mono">{file.changeType}</span>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          <span style={{ color: "var(--mint)" }}>+{file.additions}</span>{" "}
                          <span style={{ color: "var(--rose)" }}>−{file.deletions}</span>
                        </td>
                        <td className="mono dim" style={{ fontSize: 11 }}>
                          {file.proposalId}
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>

              <h2 className="section-title" style={{ fontSize: "1.02rem", marginTop: 20 }}>
                Proposed diff
              </h2>
              <div className="grid gap-3" style={{ marginTop: 12 }}>
                {patchProposals.flatMap((proposal) => proposal.files.map((file) => (<div key={`${proposal.id}-${file.path}`}>
                      <p className="mono dim" style={{ fontSize: 11, marginBottom: 5 }}>
                        {proposal.findingId} · {proposal.findingTitle}
                      </p>
                      <DiffView path={file.path} diff={file.diff} changeType={file.changeType} additions={file.additions} deletions={file.deletions}/>
                    </div>)))}
              </div>

              <h2 className="section-title" style={{ fontSize: "1.02rem", marginTop: 22 }}>
                Validation
              </h2>
              <p className="muted" style={{ fontSize: 12.6, marginTop: 6 }}>
                {preview.totals.validationPassed} passed · {preview.totals.validationFailed} failed ·{" "}
                {preview.totals.validationSkipped} skipped/unavailable. Validators check file syntax and template
                consistency only.
              </p>
              <div className="grid gap-2" style={{ marginTop: 10 }}>
                {patchProposals.map((proposal) => (<div key={`validation-${proposal.id}`} className="subtle panel-tight">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="mono" style={{ fontSize: 12 }}>
                        {proposal.findingId}
                      </span>
                      <ValidationBadge state={proposal.overallValidation}/>
                    </div>
                    <ul className="clean-list" style={{ marginTop: 8 }}>
                      {proposal.validation.map((check) => (<li key={`${proposal.id}-${check.id}-${check.label}`} style={{ alignItems: "flex-start" }}>
                          <ValidationBadge state={check.state}/>
                          <span>
                            <span style={{ color: "var(--text)", fontSize: 12.4 }}>{check.label}</span>
                            <span className="dim" style={{ display: "block", fontSize: 11.6 }}>
                              {check.detail}
                            </span>
                          </span>
                        </li>))}
                    </ul>
                  </div>))}
              </div>
            </section>

            <aside className="grid gap-5" aria-label="Pull request draft">
              <section className="glass panel">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="section-title" style={{ fontSize: "1.02rem" }}>
                    PR draft
                  </h2>
                  <span className="badge badge-mono badge-medium">preview only</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <StatusRow label="Title">{pr.draft.title}</StatusRow>
                  <StatusRow label="Branch">
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {pr.draft.branch}
                    </span>
                  </StatusRow>
                  <StatusRow label="Base">
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {pr.draft.baseBranch}
                    </span>
                  </StatusRow>
                  <StatusRow label="Remote writes">
                    <span style={{ color: "var(--rose)", fontSize: 12.5 }}>none performed</span>
                  </StatusRow>
                  <StatusRow label="Mode">
                    <span className="badge badge-mono">{pr.mode === "demo" ? "demo fixture" : "live scan"}</span>
                  </StatusRow>
                </div>
                <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 16 }}>
                  Draft description
                </h3>
                <pre className="mono" tabIndex={0} role="region" aria-label="Pull request draft description" style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--surface-solid)",
                color: "var(--grey-300)",
                fontSize: 11.6,
                lineHeight: 1.65,
                whiteSpace: "pre-wrap",
                maxHeight: 420,
                overflowY: "auto",
            }}>
                  {pr.draft.description}
                </pre>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyReviewText("PR title", pr.draft.title)}>
                    Copy title
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyReviewText("PR description", pr.draft.description)}>
                    Copy description
                  </button>
                </div>
              </section>

              <section className="glass panel" aria-labelledby="export-title">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 id="export-title" className="section-title" style={{ fontSize: "1.02rem" }}>
                      Local review package
                    </h2>
                    <p className="muted" style={{ fontSize: 12.4, marginTop: 6, lineHeight: 1.6 }}>
                      Download the selected proposed files, a unified patch, manifest and this PR draft. The archive has no
                      credentials and does not modify GitHub.
                    </p>
                  </div>
                  <span className="badge badge-mono badge-pass">safe export</span>
                </div>
                <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={downloadReviewExport} disabled={exporting || patchProposals.length === 0}>
                  {exporting ? "Preparing ZIP…" : "Download review ZIP"}
                </button>
                {reviewNotice ? (<p role="status" style={{ color: "var(--mint)", fontSize: 12.2, lineHeight: 1.55, marginTop: 9 }}>
                    {reviewNotice}
                  </p>) : null}
                {reviewError ? (<p role="alert" style={{ color: "var(--rose)", fontSize: 12.2, lineHeight: 1.55, marginTop: 9 }}>
                    {reviewError}
                  </p>) : null}
              </section>

              <section className="glass panel">
                <h2 className="section-title" style={{ fontSize: "1.02rem" }}>
                  Pre-submission checklist
                </h2>
                <div style={{ marginTop: 12 }}>
                  <Checklist items={pr.draft.checklist}/>
                </div>
                <div className="divider" style={{ margin: "14px 0" }}/>
                <h3 style={{ fontSize: "0.94rem" }}>Record verification for this selection</h3>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
                  Verification re-runs the analysis rules against the patched workspace, recalculates the score and
                  records the result. It does not push, run CI or open a pull request.
                </p>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-primary" onClick={recordVerification} disabled={verifying || patchProposals.length === 0}>
                    {verifying ? "Recording verification…" : "Verify proposed changes →"}
                  </button>
                  <Link className="btn btn-ghost" to={`/scan/${scan.scanId}`}>
                    Scan summary
                  </Link>
                </div>
                {verifyError ? (<p role="alert" style={{ color: "var(--tone-bad)", fontSize: 12.4, marginTop: 10 }}>
                    {verifyError}
                  </p>) : null}
                {verificationId ? (<p className="dim" style={{ fontSize: 11.6, marginTop: 10 }}>
                    A verification record exists for this scan. It is included in the PR draft evidence above.
                  </p>) : null}
              </section>
            </aside>
          </div>
        </>) : null}
    </div>);
}

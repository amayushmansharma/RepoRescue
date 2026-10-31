import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiClientError, api } from "../services/api-client.js";
import { useAuth } from "../state/AuthContext.jsx";
import { useWorkspaceResource } from "../state/useWorkspaceResource.js";
import { useScanWorkspace } from "../state/ScanWorkspaceProvider.jsx";
import { Checklist, DiffView, Notice, Spinner, StatusRow, ValidationBadge } from "../components/ui.jsx";

function isWorkflowFilePath(filePath) {
    if (typeof filePath !== "string") return false;
    const clean = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    return clean === ".github/workflows" || clean.startsWith(".github/workflows/");
}

export function ReviewWorkspace() {
    const { scan, scanId, selected, setSelected, verificationId, setVerificationId, resources } = useScanWorkspace();
    const { user, authenticated, hasWriteScope, requiresReauth } = useAuth();
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
    const [submitting, setSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState(null);
    const [submissionError, setSubmissionError] = useState(null);

    // Retrieve any existing pull request recorded for this scan
    useEffect(() => {
      let cancelled = false;
      api.getPullRequests(scanId)
        .then((payload) => {
          if (!cancelled && payload?.data?.pullRequests?.length > 0) {
            setSubmissionResult(payload.data.pullRequests[0]);
          }
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [scanId]);

    const patchProposals = useMemo(() => {
        return preview?.proposals?.filter((proposal) => proposal.kind === "patch") ?? [];
    }, [preview?.proposals]);

    const files = useMemo(() => {
        return patchProposals.flatMap((proposal) => proposal.files.map((file) => ({ ...file, proposalId: proposal.findingId })));
    }, [patchProposals]);

    const uniqueFiles = useMemo(() => {
        return Array.from(new Map(files.map((file) => [file.path, file])).values());
    }, [files]);

    const workflowFiles = useMemo(() => {
        return uniqueFiles.map((f) => f.path).filter((p) => isWorkflowFilePath(p));
    }, [uniqueFiles]);
    const hasWorkflowFiles = workflowFiles.length > 0;
    const hasWorkflowScope = Boolean(pr?.submission?.hasWorkflowScope);

    const workflowProposals = useMemo(() => {
        return patchProposals.filter((p) => p.files?.some((f) => isWorkflowFilePath(f.path)));
    }, [patchProposals]);
    const workflowFindingIds = useMemo(() => {
        return workflowProposals.map((p) => p.findingId);
    }, [workflowProposals]);

    const excludeWorkflowFiles = useCallback(() => {
        const remaining = selected.filter((id) => !workflowFindingIds.includes(id));
        setSelected(remaining);
        setReviewNotice(`Excluded ${workflowFiles.join(", ")}. Remaining ${remaining.length} approved change(s) are ready to submit.`);
        setSubmissionError(null);
    }, [selected, workflowFindingIds, workflowFiles, setSelected]);

    if (!scan)
        return null;

    async function submitContribution() {
        setSubmitting(true);
        setSubmissionError(null);

        try {
            const payload = {
                confirmToken: pr?.submission?.confirmToken,
                preparedAt: pr?.submission?.preparedAt,
                contentHash: pr?.submission?.contentHash,
                baseSha: pr?.submission?.currentBaseSha ?? pr?.submission?.baseSha,
                baseBranch: pr?.submission?.baseBranch ?? pr?.draft?.baseBranch,
                title: pr?.draft?.title,
                body: pr?.draft?.description,
                branchCandidate: "readiness-fix",
                verificationId,
            };
            const result = await api.submitPullRequest(scanId, selected, payload);
            if (mounted.current) {
                setSubmissionResult(result);
                setReviewNotice(`Pull request #${result.prNumber} is live on GitHub!`);
            }
        }
        catch (caught) {
            if (mounted.current) {
                setSubmissionError(caught instanceof ApiClientError ? caught.message : "Contribution submission failed.");
            }
        }
        finally {
            if (mounted.current)
                setSubmitting(false);
        }
    }
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
    function downloadPatchFile() {
        setReviewNotice(null);
        setReviewError(null);
        const patchContent = patchProposals
            .flatMap((p) => p.files.map((f) => f.diff))
            .join("\n\n");
        if (!patchContent) return;
        const blob = new Blob([patchContent], { type: "text/x-diff;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        const repoClean = (scan.repository?.name ?? "contribution").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
        anchor.download = `reporescue-${repoClean}.patch`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setReviewNotice(`Downloaded reporescue-${repoClean}.patch. Apply with 'git apply'.`);
    }
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
          {submissionResult ? (
            <Notice tone="pass" title={`Pull Request #${submissionResult.prNumber} is Live on GitHub`}>
              Changes committed to your fork (<code>{submissionResult.fork}</code>) and delivered as Pull Request #{submissionResult.prNumber} to <code>{submissionResult.upstream}</code>.
            </Notice>
          ) : (
            <Notice tone="info" title="Pre-Submission Review & One-Click Delivery">
              Review your approved changes below. When you click <strong>Create Pull Request</strong>, RepoRescue commits directly to your fork and opens a Pull Request to the original repository.
            </Notice>
          )}
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
                          <span style={{ color: "var(--green)", fontWeight: 600 }}>+{file.additions}</span>{" "}
                          <span style={{ color: "var(--red)", fontWeight: 600 }}>−{file.deletions}</span>
                        </td>
                        <td className="mono dim" style={{ fontSize: 11 }}>
                          {file.proposalId}
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>

              <h2 className="section-title" style={{ fontSize: "1.05rem", marginTop: 24 }}>
                Proposed diff ({uniqueFiles.length} files)
              </h2>
              <div className="grid gap-4" style={{ marginTop: 12 }}>
                {patchProposals.flatMap((proposal) => proposal.files.map((file) => (<div key={`${proposal.id}-${file.path}`}>
                      <p className="mono dim" style={{ fontSize: 11.5, marginBottom: 6 }}>
                        {proposal.findingId} · {proposal.findingTitle}
                      </p>
                      <DiffView path={file.path} diff={file.diff} changeType={file.changeType} additions={file.additions} deletions={file.deletions}/>
                    </div>)))}
              </div>

              <details className="disclosure-box" style={{ marginTop: 24 }}>
                <summary className="disclosure-summary">
                  <span>Syntax & consistency validation ({preview.totals.validationPassed} passed · {preview.totals.validationFailed} failed · {preview.totals.validationSkipped} skipped)</span>
                  <span className="mono dim">details ▾</span>
                </summary>
                <div className="disclosure-content">
                  <p className="muted" style={{ fontSize: 12.2, marginBottom: 12 }}>
                    Validators check file syntax, JSON formatting, and template consistency only.
                  </p>
                  <div className="grid gap-2">
                    {patchProposals.map((proposal) => (<div key={`validation-${proposal.id}`} className="subtle panel-tight">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="mono" style={{ fontSize: 12 }}>
                            {proposal.findingId}
                          </span>
                          <ValidationBadge state={proposal.overallValidation}/>
                        </div>
                        <ul className="clean-list" style={{ marginTop: 8 }}>
                          {proposal.validation.map((check, checkIndex) => (<li key={`${proposal.id}-${check.id}-${check.label}-${checkIndex}`} style={{ alignItems: "flex-start" }}>
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
                </div>
              </details>
            </section>

            <aside className="grid gap-5" aria-label="Pull request contribution">
              {/* PRIMARY DELIVERY CARD AT TOP OF RIGHT COLUMN */}
              <section className="glass panel" aria-labelledby="delivery-title" style={{ borderColor: "rgba(255, 242, 26, 0.35)", boxShadow: "0 10px 32px rgba(0, 0, 0, 0.45)" }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="badge badge-pass badge-mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Changes ready
                    </span>
                    <h2 id="delivery-title" className="section-title" style={{ fontSize: "1.2rem", marginTop: 6 }}>
                      {hasWorkflowFiles && !hasWorkflowScope
                        ? `${patchProposals.length - workflowProposals.length} approved fix${patchProposals.length - workflowProposals.length === 1 ? "" : "es"} ready`
                        : `${patchProposals.length} improvement${patchProposals.length === 1 ? "" : "s"} prepared`}
                    </h2>
                    <p className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>
                      Target: <strong style={{ color: "var(--text)" }}>{scan.repository.fullName}</strong>
                    </p>
                  </div>
                  <span className="badge badge-mono">
                    {hasWriteScope ? "PR delivery enabled" : requiresReauth ? "re-auth needed" : authenticated ? "read-only session" : "guest mode"}
                  </span>
                </div>

                {/* Approved Contribution Coordinates */}
                <div className="subtle panel-tight" style={{ marginTop: 14, fontSize: 12.2, lineHeight: 1.65 }}>
                  <div className="grid gap-1.5">
                    <div><strong>Original Target:</strong> <code>{scan.repository?.fullName}</code> (branch: <code>{pr.draft.baseBranch}</code>)</div>
                    <div><strong>Fork Destination:</strong> <code>@{user?.login ?? "your-username"}/{scan.repository?.name}</code></div>
                    <div><strong>Contribution Branch:</strong> <code>{pr.draft.branch}</code></div>
                    <div><strong>Approved Files ({uniqueFiles.length}):</strong></div>
                    <div className="flex flex-wrap gap-1.5" style={{ marginTop: 2, marginBottom: 4 }}>
                      {uniqueFiles.map((file) => {
                        const isWf = isWorkflowFilePath(file.path);
                        return (
                          <span
                            key={file.path}
                            className={`badge badge-mono ${isWf ? "badge-amber" : "badge-pass"}`}
                            style={{
                              fontSize: 11.5,
                              ...(isWf ? { borderColor: "var(--amber)", color: "var(--amber)" } : {}),
                            }}
                          >
                            {file.path} {isWf ? "(workflow scope required)" : ""}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ color: "var(--emerald)", marginTop: 4, lineHeight: 1.55 }}>
                      🔒 <strong>Safe contribution guarantee:</strong> RepoRescue opens a normal pull request from your fork. It never writes directly to the upstream repository.
                    </div>
                  </div>
                </div>

                {/* Workflow Permission Notice — informative, not jarring */}
                {hasWorkflowFiles && !hasWorkflowScope && !submissionResult ? (
                  <div className="subtle panel-tight" style={{ borderLeft: "3px solid var(--amber)", marginTop: 14, padding: "12px 14px", background: "rgba(245, 158, 11, 0.05)" }}>
                    <div style={{ fontWeight: 600, color: "var(--amber)", fontSize: 12.8, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>ℹ</span> CI Workflow Excluded
                    </div>
                    <p style={{ fontSize: 12.2, marginTop: 5, lineHeight: 1.55, color: "var(--text)" }}>
                      GitHub requires the privileged <code>workflow</code> scope to commit files under <code>.github/workflows/</code>. Your session has standard <code>public_repo</code> access. The CI workflow is excluded so your remaining {patchProposals.length - workflowProposals.length} approved improvements can be delivered safely.
                    </p>
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={excludeWorkflowFiles}
                        disabled={submitting}
                        style={{ fontWeight: 600 }}
                      >
                        Exclude CI Workflow & Keep {patchProposals.length - workflowProposals.length} Other Fixes
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Live Submission Result or Submission Button */}
                {submissionResult ? (
                  <div className="subtle panel-tight" style={{ borderLeft: "3px solid var(--emerald)", marginTop: 14, padding: "16px 18px", background: "rgba(16, 185, 129, 0.06)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <div style={{ color: "var(--emerald)", fontWeight: 700, fontSize: "1.08rem" }}>
                        ✓ Pull Request #{submissionResult.prNumber} is Live!
                      </div>
                      <span className="badge badge-pass badge-mono">
                        {submissionResult.alreadyExisted ? "existing PR linked" : "PR created"}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, marginTop: 8, color: "var(--text)", fontWeight: 500 }}>
                      {submissionResult.title ?? pr.draft.title}
                    </p>
                    <div className="grid gap-1.5" style={{ fontSize: 12, marginTop: 10, color: "var(--text-muted)" }}>
                      <div><strong>Upstream target:</strong> <code>{submissionResult.upstream}</code> ({pr.draft.baseBranch})</div>
                      <div><strong>Your fork branch:</strong> <code>{submissionResult.fork}:{submissionResult.branch}</code></div>
                      {submissionResult.commitSha ? (
                        <div><strong>Commit SHA:</strong> <code className="mono">{submissionResult.commitSha.slice(0, 10)}</code></div>
                      ) : null}
                    </div>
                    <div className="btn-row" style={{ marginTop: 16 }}>
                      <a
                        href={submissionResult.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                        style={{ fontSize: 13, padding: "9px 20px", fontWeight: 700 }}
                      >
                        Open Pull Request #{submissionResult.prNumber} on GitHub ↗
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => copyReviewText("Pull request URL", submissionResult.prUrl)}
                      >
                        Copy PR URL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 14 }}>
                    {submitting ? (
                      <div className="subtle panel-tight" style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>
                          <span className="pulse-dot" style={{ background: "var(--emerald)", marginRight: 8 }} aria-hidden="true" />
                          Delivering Contribution to GitHub…
                        </div>
                        <p className="muted" style={{ fontSize: 12.2, marginBottom: 12 }}>
                          Atomic workflow in-flight: resolving fork, writing file blobs, committing to branch, and opening pull request.
                        </p>
                        <div className="grid gap-2">
                          {[
                            { id: 1, label: "Verifying session & repository write permissions" },
                            { id: 2, label: `Resolving fork at @${user?.login ?? "contributor"}/${scan.repository?.name}` },
                            { id: 3, label: `Creating branch & committing ${uniqueFiles.length} approved file(s)` },
                            { id: 4, label: `Opening Pull Request into ${scan.repository?.fullName}:${pr.draft.baseBranch}` },
                          ].map((st) => (
                            <div key={st.id} className="flex items-center gap-2.5" style={{ fontSize: 12.2 }}>
                              <span className="pulse-dot" style={{ background: "var(--amber)", width: 8, height: 8 }} />
                              <span style={{ color: "var(--text)", fontWeight: 500 }}>
                                {st.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : authenticated && hasWriteScope ? (
                      <div className="subtle panel-tight" style={{ border: "1px solid rgba(255, 242, 26, 0.35)", padding: 18, background: "rgba(255, 242, 26, 0.03)" }}>
                        <h3 style={{ fontSize: "1.05rem", color: "var(--text)", fontWeight: 650 }}>Send Pull Request</h3>
                        <p className="muted" style={{ fontSize: 12.4, marginTop: 4 }}>
                          One click. Automatic fork, branch, commit, and pull request submission.
                        </p>
                        <div style={{ marginTop: 14 }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              letterSpacing: "0.02em",
                              padding: "13px 24px",
                              width: "100%",
                              justifyContent: "center",
                              whiteSpace: "nowrap",
                            }}
                            onClick={hasWorkflowFiles && !hasWorkflowScope ? excludeWorkflowFiles : submitContribution}
                            disabled={submitting || patchProposals.length === 0}
                          >
                            {hasWorkflowFiles && !hasWorkflowScope
                              ? `Create PR with ${patchProposals.length - workflowProposals.length} Approved Fixes`
                              : `Create PR with ${patchProposals.length} Approved Fixes`}
                          </button>
                        </div>
                        {hasWorkflowFiles && !hasWorkflowScope ? (
                          <p style={{ fontSize: 11.8, color: "var(--amber)", marginTop: 8, textAlign: "center" }}>
                            Clicking above will automatically exclude the CI workflow and deliver the remaining {patchProposals.length - workflowProposals.length} fixes.
                          </p>
                        ) : null}
                      </div>
                    ) : authenticated && !hasWriteScope ? (
                      <div className="subtle panel-tight" style={{ borderLeft: "3px solid var(--amber)", padding: "12px 14px" }}>
                        <p style={{ fontSize: 12.3, color: "var(--text)" }}>
                          Signed in as <strong>@{user?.login}</strong> with identity scopes only. To create forks and deliver PRs, please re-authorize with repository write access.
                        </p>
                        <div style={{ marginTop: 10 }}>
                          <Link to="/login" className="btn btn-primary btn-sm">
                            Re-authorize with PR Delivery Scope →
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="subtle panel-tight" style={{ padding: "14px 16px", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
                        <h3 style={{ fontSize: "0.98rem", color: "var(--text)" }}>Send Pull Request</h3>
                        <p className="muted" style={{ fontSize: 12.3, marginTop: 4 }}>
                          One click. Automatic fork, branch, commit and PR submission.
                        </p>
                        <div style={{ marginTop: 12 }}>
                          <Link to="/login" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", whiteSpace: "nowrap" }}>
                            Sign in with GitHub to Send PR
                          </Link>
                        </div>
                      </div>
                    )}

                    {submissionError ? (
                      <div style={{ marginTop: 12 }}>
                        <p role="alert" style={{ color: "var(--rose)", fontSize: 12.2, lineHeight: 1.55 }}>
                          {submissionError}
                        </p>
                        <div style={{ marginTop: 8 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={submitContribution}>
                            Retry Pull Request
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>

              {/* PR DRAFT DETAILS & DESCRIPTION */}
              <section className="glass panel">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="section-title" style={{ fontSize: "1.02rem" }}>
                    PR draft
                  </h2>
                  <span className="badge badge-mono badge-medium">preview</span>
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
                </div>
                <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 14 }}>
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
                maxHeight: 260,
                overflowY: "auto",
            }}>
                  {pr.draft.description}
                </pre>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyReviewText("PR title", pr.draft.title)}>
                    Copy title
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyReviewText("Branch name", pr.draft.branch)}>
                    Copy branch
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyReviewText("PR description", pr.draft.description)}>
                    Copy description
                  </button>
                </div>
              </section>

              <section className="glass panel" aria-labelledby="checklist-title">
                <h2 id="checklist-title" className="section-title" style={{ fontSize: "1.02rem" }}>
                  Pre-submission checklist
                </h2>
                <div style={{ marginTop: 12 }}>
                  <Checklist
                    items={pr.draft.checklist.map((item) => {
                      if (item.label.toLowerCase().includes("pull request created")) {
                        return {
                          ...item,
                          done: Boolean(submissionResult),
                          note: submissionResult
                            ? `Pull request #${submissionResult.prNumber} opened on GitHub`
                            : "Delivered automatically upon clicking 'Create Pull Request'",
                        };
                      }
                      return item;
                    })}
                  />
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

              <section className="glass panel" aria-labelledby="export-title">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 id="export-title" className="section-title" style={{ fontSize: "1.02rem" }}>
                      Local review package (Optional export)
                    </h2>
                    <p className="muted" style={{ fontSize: 12.4, marginTop: 6, lineHeight: 1.6 }}>
                      Download the selected proposed files, a unified patch, manifest and this PR draft for local review or manual terminal workflows.
                    </p>
                  </div>
                  <span className="badge badge-mono badge-pass">safe export</span>
                </div>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={downloadReviewExport} disabled={exporting || patchProposals.length === 0}>
                    {exporting ? "Preparing ZIP…" : "Download review ZIP"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={downloadPatchFile} disabled={patchProposals.length === 0}>
                    Download .patch file
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const patch = patchProposals.flatMap((p) => p.files.map((f) => f.diff)).join("\n\n");
                      copyReviewText("Unified patch", patch);
                    }}
                    disabled={patchProposals.length === 0}
                  >
                    Copy patch
                  </button>
                </div>
                {reviewNotice ? (<p role="status" style={{ color: "var(--mint)", fontSize: 12.2, lineHeight: 1.55, marginTop: 9 }}>
                    {reviewNotice}
                  </p>) : null}
                {reviewError ? (<p role="alert" style={{ color: "var(--rose)", fontSize: 12.2, lineHeight: 1.55, marginTop: 9 }}>
                    {reviewError}
                  </p>) : null}
              </section>
            </aside>
          </div>
        </>) : null}
    </div>);
}

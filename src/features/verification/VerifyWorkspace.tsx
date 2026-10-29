"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { VerificationRecord } from "@/lib/types";
import { ApiClientError, api } from "@/lib/api-client";
import { useScanWorkspace } from "@/features/workspace/ScanWorkspaceProvider";
import { Notice, ScoreRing, Spinner, StatusRow, ValidationBadge, formatUtc } from "@/components/ui";

export function VerifyWorkspace() {
  const { scan, scanId, selected, verificationId, setVerificationId } = useScanWorkspace();
  const [storedRecord, setStoredRecord] = useState<VerificationRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const selectionKey = [...selected].sort().join(",");

  useEffect(() => {
    if (!verificationId) return;
    let cancelled = false;
    api.getVerification(verificationId)
      .then((payload) => {
        if (cancelled) return;
        if (payload.verification.scanId !== scanId || [...payload.verification.findingIds].sort().join(",") !== selectionKey) {
          setVerificationId(null);
          setError({ message: "This verification belongs to a different selection. Run verification for the current findings.", code: "SELECTION_CHANGED" });
          return;
        }
        setStoredRecord(payload.verification);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) return;
        const apiError = caught instanceof ApiClientError ? caught : null;
        if (apiError?.code === "NOT_FOUND") setVerificationId(null);
        setError({ message: apiError?.message ?? "The verification record could not be loaded. Run verification again.", code: apiError?.code });
      });
    return () => { cancelled = true; };
  }, [verificationId, setVerificationId, scanId, selectionKey]);

  if (!scan) return null;

  async function runVerification() {
    if (selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await api.runVerification(scanId, selected);
      setStoredRecord(payload.verification);
      setVerificationId(payload.verification.id);
    } catch (caught) {
      const apiError = caught instanceof ApiClientError ? caught : null;
      setError({ message: apiError?.message ?? "Verification could not run.", code: apiError?.code });
    } finally {
      setLoading(false);
    }
  }

  const record = storedRecord?.id === verificationId && storedRecord.scanId === scanId && [...storedRecord.findingIds].sort().join(",") === selectionKey ? storedRecord : null;
  const loadingRecord = Boolean(verificationId) && storedRecord?.id !== verificationId && !error && !loading;
  const passed = record?.status === "passed";
  const failed = record?.status === "failed";

  return (
    <div className="grid gap-5">
      <section className="glass panel" aria-labelledby="verify-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Stage 05 · verify</span>
            <h1 id="verify-title" style={{ fontSize: "1.35rem", marginTop: 8 }}>
              What was actually checked
            </h1>
            <p className="muted" style={{ fontSize: 13.2, marginTop: 6, maxWidth: 690 }}>
              Verification is a recorded local re-analysis of the patched workspace. Remote CI and pull request state are
              reported as <span className="mono">not run</span> because this build never writes to GitHub.
            </p>
          </div>
          <div className="btn-row">
            <Link className="btn btn-ghost btn-sm" href={`/scan/${scan.scanId}/review`}>
              ← Review changes
            </Link>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={runVerification}
              disabled={loading || selected.length === 0}
              title={selected.length === 0 ? "Select findings first" : undefined}
            >
              {loading ? "Running…" : "Run verification"}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Notice tone="info" title="Scope of this verification">
            Local validation only. RepoRescue applies the proposed files to an in-memory copy of the scanned snapshot,
            re-evaluates the same {scan.findings.length} rules and recalculates the readiness score. Repository code is
            never executed and no dependencies are installed.
          </Notice>
        </div>
      </section>

      {selected.length === 0 ? (
        <Notice tone="warn" title="No findings selected">
          Verification needs a selection to verify. Choose findings in FIND, then return here.
        </Notice>
      ) : null}

      {loading || loadingRecord ? (
        <div className="glass panel">
          <Spinner label={loading ? "Applying proposed changes in the local workspace and re-running rules…" : "Loading the recorded verification…"} />
        </div>
      ) : null}

      {error ? (
        <Notice tone="error" title={error.code ? `Verification error — ${error.code}` : "Verification error"}>
          {error.message}
        </Notice>
      ) : null}

      {!record && !loading && !loadingRecord && !error && selected.length > 0 ? (
        <section className="glass panel">
          <h2 style={{ fontSize: "1.02rem" }}>Not started</h2>
          <p className="muted" style={{ fontSize: 12.9, marginTop: 6, maxWidth: 640 }}>
            No verification has been recorded for this selection in this session. Run it to produce evidence: which
            findings no longer reproduce, the recalculated score and which checks were skipped or unavailable.
          </p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={runVerification} disabled={loading}>
            {loading ? "Running…" : "Run local verification"}
          </button>
        </section>
      ) : null}

      {record ? (
        <>
          <section className="glass panel" aria-labelledby="status-title">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h2 id="status-title" className="section-title" style={{ fontSize: "1.05rem" }}>
                  Local validation{" "}
                  <span className={`badge badge-mono ${passed ? "badge-pass" : failed ? "badge-fail" : "badge-skip"}`}>
                    {record.status}
                  </span>
                </h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 560, lineHeight: 1.65 }}>
                  {record.summary}
                </p>
                <div style={{ marginTop: 12 }}>
                  <StatusRow label="Verification id">
                    <span className="mono" style={{ fontSize: 11 }}>{record.id}</span>
                  </StatusRow>
                  <StatusRow label="Recorded">{formatUtc(record.createdAt)}</StatusRow>
                  <StatusRow label="Scope">
                    <span className="badge badge-mono">{record.scope} workspace</span>
                  </StatusRow>
                  <StatusRow label="Findings verified">{record.findingIds.length}</StatusRow>
                  <StatusRow label="Mode">
                    <span className="badge badge-mono">{record.mode === "demo" ? "DEMO fixture" : "LIVE scan"}</span>
                  </StatusRow>
                </div>
              </div>
              {record.comparison ? (
                <div className="flex items-center gap-4">
                  <div style={{ textAlign: "center" }}>
                    <ScoreRing score={record.comparison.beforeScore} size={104} label="before" />
                  </div>
                  <span aria-hidden="true" style={{ color: "var(--text-dim)", fontSize: 20 }}>
                    →
                  </span>
                  <div style={{ textAlign: "center" }}>
                    <ScoreRing score={record.comparison.afterScore} size={104} label="after" />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2" style={{ marginTop: 18 }}>
              <div className="alert alert-warn">
                <span aria-hidden="true">!</span>
                <div>
                  <strong style={{ display: "block" }}>Remote CI: not run</strong>
                  No commit was pushed, so no CI job exists for these changes. GitHub Actions evidence can only come from
                  GitHub after a real push.
                </div>
              </div>
              <div className="alert alert-warn">
                <span aria-hidden="true">!</span>
                <div>
                  <strong style={{ display: "block" }}>Pull request: not created</strong>
                  RepoRescue performed no GitHub write. Merge status cannot be reported because nothing was opened.
                </div>
              </div>
            </div>
          </section>

          <section className="glass panel" aria-labelledby="checks-title">
            <h2 id="checks-title" className="section-title" style={{ fontSize: "1.02rem" }}>
              Verification checks
            </h2>
            <div className="scroll-x" tabIndex={0} role="region" aria-label="Verification checks table" style={{ marginTop: 12 }}>
              <table className="table">
                <caption className="sr-only">Individual verification checks and their evidence</caption>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">State</th>
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {record.checks.map((check) => (
                    <tr key={check.id}>
                      <td style={{ minWidth: 170 }}>
                        <span style={{ fontSize: 12.8, color: "var(--text)" }}>{check.label}</span>
                        <span className="mono dim" style={{ display: "block", fontSize: 10.5 }}>
                          {check.id}
                        </span>
                      </td>
                      <td>
                        <ValidationBadge state={check.state} />
                      </td>
                      <td className="muted" style={{ fontSize: 12.4, lineHeight: 1.6 }}>
                        {check.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {record.comparison ? (
            <section className="glass panel" aria-labelledby="comparison-title">
              <h2 id="comparison-title" className="section-title" style={{ fontSize: "1.02rem" }}>
                Before / after
              </h2>
              <p className="muted" style={{ fontSize: 12.9, marginTop: 8, lineHeight: 1.65, maxWidth: 760 }}>
                {record.comparison.explanation}
              </p>
              <div className="stat-grid" style={{ marginTop: 14 }}>
                <div className="stat">
                  <div className="stat-value">
                    {record.comparison.beforeScore} → <span style={{ color: "var(--mint)" }}>{record.comparison.afterScore}</span>
                  </div>
                  <div className="stat-label">readiness score</div>
                </div>
                <div className="stat">
                  <div className="stat-value" style={{ color: "var(--mint)" }}>
                    {record.comparison.resolved.length}
                  </div>
                  <div className="stat-label">findings resolved</div>
                </div>
                <div className="stat">
                  <div className="stat-value" style={{ color: "var(--amber)" }}>
                    {record.comparison.remaining.length}
                  </div>
                  <div className="stat-label">still detectable</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{record.comparison.newlyDetected.length}</div>
                  <div className="stat-label">newly detected</div>
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2" style={{ marginTop: 16 }}>
                <div>
                  <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Resolved by this patch
                  </h3>
                  {record.comparison.resolved.length === 0 ? (
                    <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
                      None of the selected findings stopped reproducing.
                    </p>
                  ) : (
                    <ul className="clean-list" style={{ marginTop: 8 }}>
                      {record.comparison.resolved.map((finding) => (
                        <li key={finding.id}>
                          <span className="bullet bullet-mint" aria-hidden="true" />
                          <span>
                            {finding.title} <span className="mono dim" style={{ fontSize: 10.5 }}>{finding.id}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Still detectable after the patch
                  </h3>
                  {record.comparison.remaining.length === 0 ? (
                    <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
                      No findings remain detectable in the patched workspace.
                    </p>
                  ) : (
                    <ul className="clean-list" style={{ marginTop: 8 }}>
                      {record.comparison.remaining.map((finding) => (
                        <li key={finding.id}>
                          <span className="bullet" aria-hidden="true" />
                          <span>
                            {finding.title} <span className="mono dim" style={{ fontSize: 10.5 }}>{finding.id}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {record.comparison.newlyDetected.length > 0 ? (
                    <>
                      <h3 className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 12 }}>
                        Newly detected
                      </h3>
                      <ul className="clean-list" style={{ marginTop: 8 }}>
                        {record.comparison.newlyDetected.map((finding) => (
                          <li key={finding.id}>
                            <span className="bullet bullet-rose" aria-hidden="true" />
                            <span>
                              {finding.title} <span className="mono dim" style={{ fontSize: 10.5 }}>{finding.id}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className="glass panel" aria-labelledby="verify-limits-title">
            <h2 id="verify-limits-title" className="section-title" style={{ fontSize: "1.02rem" }}>
              Limitations of this evidence
            </h2>
            <ul className="clean-list" style={{ marginTop: 12 }}>
              {record.limitations.map((limitation) => (
                <li key={limitation}>
                  <span className="bullet bullet-rose" aria-hidden="true" />
                  <span>{limitation}</span>
                </li>
              ))}
            </ul>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Link className="btn btn-ghost" href={`/scan/${scan.scanId}/review`}>
                Back to review
              </Link>
              <Link className="btn btn-ghost" href={`/scan/${scan.scanId}/findings`}>
                Remaining findings
              </Link>
              <button type="button" className="btn btn-primary" onClick={runVerification} disabled={loading || selected.length === 0}>
                Re-run verification
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiClientError, api } from "../services/api-client.js";
import { Notice, Spinner } from "../components/ui.jsx";

const DIMENSIONS = ["documentation", "setup", "testing", "contribution", "hygiene"];

export default function MethodologyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .capabilities()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiClientError ? caught.message : "The capability report could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell" style={{ paddingTop: 36, paddingBottom: 30 }}>
      <span className="eyebrow">Method · read this before trusting a score</span>
      <h1 className="display" style={{ fontSize: "clamp(1.9rem, 3.4vw, 2.7rem)", marginTop: 12 }}>A score you can audit</h1>
      <p className="lede" style={{ marginTop: 14, maxWidth: 760 }}>
        The readiness score measures how prepared a repository is for a first contribution. It is not a quality, security
        or maintainability rating. Every point is earned by a named check against evidence captured during the scan.
      </p>

      {error ? (
        <div style={{ marginTop: 20 }}>
          <Notice tone="error" title="Capabilities unavailable">{error}</Notice>
        </div>
      ) : null}
      {!data && !error ? (
        <div className="glass panel" style={{ marginTop: 20 }}>
          <Spinner label="Loading the rule catalogue from the running engine…" />
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" style={{ marginTop: 26 }}>
            <section className="glass panel" aria-labelledby="weights-title">
              <h2 id="weights-title" className="section-title">Documented weights (sum = 100)</h2>
              <div className="scroll-x" tabIndex={0} role="region" aria-label="Scoring weights table" style={{ marginTop: 12 }}>
                <table className="table">
                  <caption className="sr-only">Readiness score dimensions and their fixed weights</caption>
                  <thead>
                    <tr><th scope="col">Dimension</th><th scope="col">Weight</th><th scope="col">Checks</th></tr>
                  </thead>
                  <tbody>
                    {DIMENSIONS.map((dimension) => (
                      <tr key={dimension}>
                        <td style={{ color: "var(--text)" }}>{data.scoring.labels[dimension]}</td>
                        <td className="mono">{data.scoring.weights[dimension]}%</td>
                        <td className="mono dim" style={{ fontSize: 11.5 }}>
                          {data.ruleCatalogue.checks.filter((check) => check.dimension === dimension).map((check) => check.id).join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="subtle panel-tight" style={{ marginTop: 14 }}>
                <p className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>FORMULA</p>
                <p className="mono" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.7, color: "var(--text-muted)" }}>{data.scoring.formula}</p>
              </div>
              <ul className="clean-list" style={{ marginTop: 14 }}>
                <li><span className="bullet bullet-mint" aria-hidden="true" /><span><strong>Partial credit</strong> is only used where a check has a genuine middle state (for example a template that exists but misses required keys).</span></li>
                <li><span className="bullet bullet-mint" aria-hidden="true" /><span><strong>Not applicable</strong> checks are removed from the denominator and listed with their reason, so coverage is always reported next to the total.</span></li>
                <li><span className="bullet bullet-mint" aria-hidden="true" /><span><strong>Missing evidence is not a failure of the code.</strong> A README that omits prerequisites costs documentation points; it says nothing about engineering quality.</span></li>
              </ul>
            </section>

            <aside className="grid gap-5">
              <section className="glass panel">
                <h2 className="section-title" style={{ fontSize: "1rem" }}>Capability states (live from the API)</h2>
                <ul className="clean-list" style={{ marginTop: 10 }}>
                  {Object.entries(data.capabilities)
                    .filter(([key]) => key !== "storage")
                    .map(([key, value]) => (
                      <li key={key}>
                        <span className={`bullet ${value.available ? "bullet-mint" : "bullet-rose"}`} aria-hidden="true" />
                        <span>
                          <span style={{ color: "var(--text)" }}>{key}</span> — {value.available ? "available" : value.state ?? "unavailable"}.{" "}
                          <span className="dim">{value.note}</span>
                        </span>
                      </li>
                    ))}
                  <li>
                    <span className="bullet" aria-hidden="true" />
                    <span><span style={{ color: "var(--text)" }}>storage</span> — {data.capabilities.storage.mode}: <span className="dim">{data.capabilities.storage.detail}</span></span>
                  </li>
                </ul>
              </section>
              <section className="glass panel">
                <h2 className="section-title" style={{ fontSize: "1rem" }}>Security posture</h2>
                <ul className="clean-list" style={{ marginTop: 10 }}>
                  <li><span className="bullet" aria-hidden="true" /><span>Explicit request validation with a 64 KB JSON body limit and typed error codes.</span></li>
                  <li><span className="bullet" aria-hidden="true" /><span>Fixed-window rate limits on scan, remediation, export and verification endpoints.</span></li>
                  <li><span className="bullet" aria-hidden="true" /><span>CSP, nosniff and a restrictive referrer policy on every response; embedding is lockable via <span className="mono">FRAME_ANCESTORS</span>.</span></li>
                  <li><span className="bullet" aria-hidden="true" /><span>GitHub tokens are read only from server environment variables; the API is same-origin unless one explicit client origin is allowed.</span></li>
                  <li><span className="bullet" aria-hidden="true" /><span>Repository content is untrusted: bounded downloads, no execution, no shell interpolation, path-traversal rejection.</span></li>
                </ul>
              </section>
            </aside>
          </div>

          <section className="glass panel" style={{ marginTop: 22 }} aria-labelledby="checks-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="checks-title" className="section-title">Rule catalogue</h2>
                <p className="muted" style={{ fontSize: 12.8, marginTop: 6, maxWidth: 720 }}>
                  Generated directly from the running analysis engine. Statuses shown are for the bundled{" "}
                  <span className="mono">{data.ruleCatalogue.fixture}</span> fixture, so they are reproducible.
                </p>
              </div>
              <Link className="btn btn-ghost btn-sm" to="/">Scan a repository</Link>
            </div>
            <div className="scroll-x" tabIndex={0} role="region" aria-label="Rule catalogue table" style={{ marginTop: 14 }}>
              <table className="table">
                <caption className="sr-only">Implemented analysis checks, weights and demo status</caption>
                <thead>
                  <tr><th scope="col">Check</th><th scope="col">Dimension</th><th scope="col">Weight</th><th scope="col">Beacon fixture</th></tr>
                </thead>
                <tbody>
                  {data.ruleCatalogue.checks.map((check) => (
                    <tr key={check.id}>
                      <td>
                        <span style={{ color: "var(--text)", fontSize: 12.8 }}>{check.label}</span>
                        <span className="mono dim" style={{ display: "block", fontSize: 10.5 }}>{check.id}</span>
                      </td>
                      <td className="muted" style={{ fontSize: 12.3 }}>{data.scoring.labels[check.dimension]}</td>
                      <td className="mono">{check.weight}</td>
                      <td>
                        <span className={`badge badge-mono ${check.status === "pass" ? "badge-pass" : check.status === "fail" ? "badge-fail" : "badge-skip"}`}>{check.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2" style={{ marginTop: 22 }}>
            <section className="glass panel" aria-labelledby="remediation-title">
              <h2 id="remediation-title" className="section-title" style={{ fontSize: "1rem" }}>
                Automatic remediation rules ({data.automatedRemediationRuleIds.length})
              </h2>
              <p className="muted" style={{ fontSize: 12.8, marginTop: 6 }}>
                Only findings with a deterministic, template-based patch are auto-fixable. Everything else returns manual instructions.
              </p>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
                {data.automatedRemediationRuleIds.map((ruleId) => (
                  <span className="badge badge-mono badge-pass" key={ruleId}>{ruleId}</span>
                ))}
              </div>
              <p className="dim" style={{ fontSize: 11.8, marginTop: 12, lineHeight: 1.6 }}>
                Never automated: choosing a license, rotating committed secrets, inventing a test suite, rewriting an existing CI workflow, or changing repository settings.
              </p>
            </section>
            <section className="glass panel" aria-labelledby="api-title">
              <h2 id="api-title" className="section-title" style={{ fontSize: "1rem" }}>REST API</h2>
              <div className="scroll-x" tabIndex={0} role="region" aria-label="API routes table" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Purpose</th></tr></thead>
                  <tbody>
                    {data.apiRoutes.map(([method, path, purpose]) => (
                      <tr key={`${method}-${path}`}>
                        <td className="mono" style={{ fontSize: 11, color: "var(--mint)" }}>{method}</td>
                        <td className="mono" style={{ fontSize: 11.2 }}>{path}</td>
                        <td className="muted" style={{ fontSize: 11.8 }}>{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

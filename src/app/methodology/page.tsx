import Link from "next/link";
import { DIMENSION_WEIGHTS, SCORE_FORMULA_TEXT } from "@/lib/scoring-text";
import { AUTOMATED_REMEDIATION_RULE_IDS } from "@/server/analysis/remediations";
import { evaluateRepository } from "@/server/analysis/rules";
import { buildSnapshot } from "@/server/analysis/snapshot";
import { DEMO_FIXTURES, filesFromFixture } from "@/server/demo/fixtures";
import { DIMENSION_LABELS, type DimensionId } from "@/lib/types";

export const dynamic = "force-dynamic";

const DIMENSIONS: DimensionId[] = ["documentation", "setup", "testing", "contribution", "hygiene"];
const API_ROUTES = [
  ["GET", "/api/health", "Service, database, GitHub credential mode and write-policy status"],
  ["GET", "/api/demo-repositories", "Bundled deterministic fixtures"],
  ["POST", "/api/scans", "Create a demo (`demoId`) or live (`repository`) scan"],
  ["GET", "/api/scans", "Recent scan history"],
  ["GET", "/api/scans/:scanId", "Client-safe assessment (no repository file bodies)"],
  ["GET", "/api/scans/:scanId/findings", "Filtered findings (severity, category, q, sort, fixable)"],
  ["GET", "/api/scans/:scanId/score", "Dimension breakdown, deductions and limitations"],
  ["POST", "/api/scans/:scanId/rescan", "Fresh evidence, new scan record"],
  ["POST", "/api/scans/:scanId/export", "Download selected proposed files, patch, manifest and review guide as ZIP"],
  ["POST", "/api/remediations/preview", "Rule-based patches and diffs for selected findings"],
  ["POST", "/api/remediations/validate", "Server-side validation of regenerated patches"],
  ["POST", "/api/pull-requests/preview", "PR title, branch, description and checklist (preview only)"],
  ["POST", "/api/verifications", "Record a local verification"],
  ["GET", "/api/verifications/:id", "Retrieve recorded verification evidence"],
];

export default function MethodologyPage() {
  const fixture = DEMO_FIXTURES[0];
  const snapshot = buildSnapshot({
    repository: fixture.repository,
    files: filesFromFixture(fixture),
    tree: [...fixture.files.map((file) => file.path), ...fixture.treeExtra],
    mode: "demo",
    fetchedAt: fixture.fetchedAt,
    analysisLimitations: [],
  });
  const { checks } = evaluateRepository(snapshot);

  return (
    <div className="shell" style={{ paddingTop: 36, paddingBottom: 30 }}>
      <span className="eyebrow">Method · read this before trusting a score</span>
      <h1 className="display" style={{ fontSize: "clamp(1.9rem, 3.4vw, 2.7rem)", marginTop: 12 }}>
        A score you can audit
      </h1>
      <p className="lede" style={{ marginTop: 14, maxWidth: 760 }}>
        The readiness score measures how prepared a repository is for a first contribution. It is not a quality, security
        or maintainability rating. Every point is earned by a named check against evidence captured during the scan.
      </p>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" style={{ marginTop: 26 }}>
        <section className="glass panel" aria-labelledby="weights-title">
          <h2 id="weights-title" className="section-title">
            Documented weights (sum = 100)
          </h2>
          <div className="scroll-x" tabIndex={0} role="region" aria-label="Scoring weights table" style={{ marginTop: 12 }}>
            <table className="table">
              <caption className="sr-only">Readiness score dimensions and their fixed weights</caption>
              <thead>
                <tr>
                  <th scope="col">Dimension</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Checks</th>
                </tr>
              </thead>
              <tbody>
                {DIMENSIONS.map((dimension) => {
                  const dimensionChecks = checks.filter((check) => check.dimension === dimension);
                  return (
                    <tr key={dimension}>
                      <td style={{ color: "var(--text)" }}>{DIMENSION_LABELS[dimension]}</td>
                      <td className="mono">{DIMENSION_WEIGHTS[dimension]}%</td>
                      <td className="mono dim" style={{ fontSize: 11.5 }}>
                        {dimensionChecks.map((check) => check.id).join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="subtle panel-tight" style={{ marginTop: 14 }}>
            <p className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>
              FORMULA
            </p>
            <p className="mono" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.7, color: "var(--text-muted)" }}>
              {SCORE_FORMULA_TEXT}
            </p>
          </div>
          <ul className="clean-list" style={{ marginTop: 14 }}>
            <li>
              <span className="bullet bullet-mint" aria-hidden="true" />
              <span>
                <strong>Partial credit</strong> is only used where a check has a genuine middle state (for example a
                template that exists but misses required keys).
              </span>
            </li>
            <li>
              <span className="bullet bullet-mint" aria-hidden="true" />
              <span>
                <strong>Not applicable</strong> checks are removed from the denominator and listed with their reason, so
                coverage is always reported next to the total.
              </span>
            </li>
            <li>
              <span className="bullet bullet-mint" aria-hidden="true" />
              <span>
                <strong>Missing evidence is not a failure of the code.</strong> A README that omits prerequisites costs
                documentation points; it says nothing about engineering quality.
              </span>
            </li>
          </ul>
        </section>

        <aside className="grid gap-5">
          <section className="glass panel">
            <h2 className="section-title" style={{ fontSize: "1rem" }}>
              Verification scope
            </h2>
            <ul className="clean-list" style={{ marginTop: 10 }}>
              <li>
                <span className="bullet bullet-mint" aria-hidden="true" />
                <span>Local: patch consistency, JSON/YAML/markdown/env-template checks, rule re-evaluation and a recalculated score.</span>
              </li>
              <li>
                <span className="bullet" aria-hidden="true" />
                <span>Skipped: dependency installation and test execution — deliberately never performed.</span>
              </li>
              <li>
                <span className="bullet bullet-rose" aria-hidden="true" />
                <span>Not run: remote CI, review and merge state. Nothing is pushed, so no such evidence can exist.</span>
              </li>
            </ul>
          </section>
          <section className="glass panel">
            <h2 className="section-title" style={{ fontSize: "1rem" }}>
              Security posture
            </h2>
            <ul className="clean-list" style={{ marginTop: 10 }}>
              <li><span className="bullet" aria-hidden="true" /><span>Zod-free explicit request validation with 64 KB body limits and typed errors.</span></li>
              <li><span className="bullet" aria-hidden="true" /><span>Fixed-window rate limits on scan, remediation and verification endpoints.</span></li>
              <li><span className="bullet" aria-hidden="true" /><span>CSP (no third-party origins), nosniff and a restrictive referrer policy on every response; iframe embedding is lockable per deployment via <span className="mono">FRAME_ANCESTORS</span>.</span></li>
              <li><span className="bullet" aria-hidden="true" /><span>GitHub tokens are read only from server environment variables; no client access, no CORS expansion.</span></li>
              <li><span className="bullet" aria-hidden="true" /><span>Repository content is untrusted: bounded downloads, no execution, no shell interpolation, path-traversal rejection.</span></li>
            </ul>
          </section>
        </aside>
      </div>

      <section className="glass panel" style={{ marginTop: 22 }} aria-labelledby="checks-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="checks-title" className="section-title">
              Rule catalogue
            </h2>
            <p className="muted" style={{ fontSize: 12.8, marginTop: 6, maxWidth: 720 }}>
              Generated directly from the deployed analysis engine. Statuses shown are for the bundled{" "}
              <span className="mono">{fixture.repository.fullName}</span> fixture, so they are reproducible.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" href="/">
            Scan a repository
          </Link>
        </div>
        <div className="scroll-x" tabIndex={0} role="region" aria-label="Rule catalogue table" style={{ marginTop: 14 }}>
          <table className="table">
            <caption className="sr-only">Implemented analysis checks, weights and demo status</caption>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Dimension</th>
                <th scope="col">Weight</th>
                <th scope="col">Beacon fixture</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id}>
                  <td>
                    <span style={{ color: "var(--text)", fontSize: 12.8 }}>{check.label}</span>
                    <span className="mono dim" style={{ display: "block", fontSize: 10.5 }}>
                      {check.id}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12.3 }}>
                    {DIMENSION_LABELS[check.dimension]}
                  </td>
                  <td className="mono">{check.weight}</td>
                  <td>
                    <span
                      className={`badge badge-mono ${
                        check.status === "pass" ? "badge-pass" : check.status === "fail" ? "badge-fail" : "badge-skip"
                      }`}
                    >
                      {check.status}
                    </span>
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
            Automatic remediation rules ({AUTOMATED_REMEDIATION_RULE_IDS.length})
          </h2>
          <p className="muted" style={{ fontSize: 12.8, marginTop: 6 }}>
            Only findings with a deterministic, template-based patch are auto-fixable. Everything else returns manual
            instructions.
          </p>
          <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
            {AUTOMATED_REMEDIATION_RULE_IDS.map((ruleId) => (
              <span className="badge badge-mono badge-pass" key={ruleId}>
                {ruleId}
              </span>
            ))}
          </div>
          <p className="dim" style={{ fontSize: 11.8, marginTop: 12, lineHeight: 1.6 }}>
            Never automated: choosing a license, rotating committed secrets, inventing a test suite, rewriting an existing
            CI workflow, or changing repository settings.
          </p>
        </section>

        <section className="glass panel" aria-labelledby="api-title">
          <h2 id="api-title" className="section-title" style={{ fontSize: "1rem" }}>
            REST API
          </h2>
          <div className="scroll-x" tabIndex={0} role="region" aria-label="API routes table" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {API_ROUTES.map(([method, path, purpose]) => (
                  <tr key={`${method}-${path}`}>
                    <td className="mono" style={{ fontSize: 11, color: "var(--mint)" }}>
                      {method}
                    </td>
                    <td className="mono" style={{ fontSize: 11.2 }}>
                      {path}
                    </td>
                    <td className="muted" style={{ fontSize: 11.8 }}>
                      {purpose}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

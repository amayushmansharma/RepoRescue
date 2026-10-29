import Link from "next/link";
import { DEMO_REPOSITORIES } from "@/server/demo/fixtures";
import { listStoredScans } from "@/server/store/scan-store";
import { ScanLauncher } from "@/features/scan/ScanLauncher";
import { ModeBadge, formatUtc } from "@/components/ui";

export const dynamic = "force-dynamic";

const STAGES = [
  { name: "Scan", copy: "Validate the repository input and collect the evidence the rules need. Live or fixture." },
  { name: "Find", copy: "Review findings with the exact file, line and rationale. Confirmed vs needs-review is explicit." },
  { name: "Fix", copy: "Turn supported findings into proposed patches. Unsupported ones get manual instructions, never guesses." },
  { name: "Review", copy: "Inspect unified diffs, validation results and the PR draft before anything leaves the browser." },
  { name: "Verify", copy: "Re-run the rules against the patched workspace. Local evidence is separated from remote CI." },
];

export default async function OverviewPage() {
  const recent = await listStoredScans(6);

  return (
    <div className="shell" style={{ paddingTop: 44, paddingBottom: 20 }}>
      <div className="hero-grid">
        <section aria-labelledby="hero-title">
          <span className="eyebrow">
            <span className="pulse-dot" aria-hidden="true" />
            open-source contribution readiness
          </span>
          <h1 id="hero-title" className="display" style={{ marginTop: 14 }}>
            Rescue the first contribution,
            <br />
            <span style={{ color: "var(--lavender-bright)" }}>not just the README.</span>
          </h1>
          <p className="lede" style={{ marginTop: 16, maxWidth: 560 }}>
            RepoRescue inspects a repository&apos;s real evidence — README, manifests, lockfiles, CI, contribution guides,
            templates and environment usage — then explains what blocks a newcomer, proposes reviewable patches and
            verifies what actually changed.
          </p>

          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 18 }}>
            <span className="badge badge-mono">21 deterministic checks</span>
            <span className="badge badge-mono">5 weighted dimensions</span>
            <span className="badge badge-mono">no code execution</span>
            <span className="badge badge-mono">no GitHub writes</span>
          </div>

          <div className="subtle panel-tight" style={{ marginTop: 22 }}>
            <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-dim)" }}>
              WHY THIS EXISTS
            </p>
            <p style={{ marginTop: 8, fontSize: 13.4, lineHeight: 1.68, color: "var(--text-muted)" }}>
              A valuable repository can still be impossible to start on: setup steps are incomplete, required environment
              variables appear only inside source files, CI is missing, and nobody knows which improvements are safe to
              attempt. RepoRescue turns that informal archaeology into a five-stage workflow with evidence at every step.
            </p>
          </div>
        </section>

        <ScanLauncher demos={DEMO_REPOSITORIES} />
      </div>

      <section aria-labelledby="stages-title" style={{ marginTop: 52 }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="stages-title" className="section-title">
              The workflow is the product
            </h2>
            <p className="muted" style={{ fontSize: 13.4, marginTop: 6, maxWidth: 640 }}>
              Every stage has explicit preconditions. A patch is never generated before evidence, and nothing is called
              verified without a recorded check.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" href="/methodology">
            Read the scoring method
          </Link>
        </div>
        <div className="stage-strip" style={{ marginTop: 16 }}>
          {STAGES.map((stage, index) => (
            <div className="stage-card" key={stage.name}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--lavender-bright)" }}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 style={{ fontSize: "0.95rem", marginTop: 6 }}>{stage.name}</h3>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 6 }}>
                {stage.copy}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-title" style={{ marginTop: 46 }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="recent-title" className="section-title">
            Recent scans
          </h2>
          <Link className="mono" href="/scans" style={{ fontSize: 12.5, color: "var(--lavender-bright)" }}>
            all scans →
          </Link>
        </div>
        <div className="glass" style={{ marginTop: 14, overflow: "hidden" }}>
          {recent.length === 0 ? (
            <div className="panel">
              <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
                No scans yet. Start with a bundled demo above — the complete FIND → FIX → REVIEW → VERIFY workflow runs
                without a GitHub token.
              </p>
            </div>
          ) : (
            <div className="scroll-x" tabIndex={0} role="region" aria-label="Recent scans table">
              <table className="table">
                <caption className="sr-only">Most recent repository scans, including demo fixture scans</caption>
                <thead>
                  <tr>
                    <th scope="col">Repository</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Score</th>
                    <th scope="col">Findings</th>
                    <th scope="col">When</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((scan) => (
                    <tr key={scan.scanId}>
                      <td>
                        <span className="mono" style={{ fontSize: 12.6 }}>
                          {scan.repository}
                        </span>
                      </td>
                      <td>
                        <ModeBadge mode={scan.mode} />
                      </td>
                      <td>
                        <span style={{ color: scan.score >= 80 ? "var(--score-high)" : scan.score >= 55 ? "var(--score-mid)" : "var(--score-low)", fontWeight: 600 }}>
                          {scan.score}
                        </span>
                        <span className="dim mono" style={{ fontSize: 11 }}>
                          {" "}
                          /100
                        </span>
                      </td>
                      <td className="muted">{scan.findings}</td>
                      <td className="dim" style={{ fontSize: 12 }}>
                        {formatUtc(scan.createdAt)}
                      </td>
                      <td>
                        <Link className="btn btn-ghost btn-sm" href={`/scan/${scan.scanId}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="dim" style={{ fontSize: 11.8, marginTop: 10 }}>
          Scan records are stored in PostgreSQL when it is reachable; otherwise the API state reports in-process storage
          explicitly. Demo scans are labelled DEMO everywhere.
        </p>
      </section>

      <section aria-labelledby="boundary-title" style={{ marginTop: 46 }}>
        <div className="glass panel">
          <h2 id="boundary-title" className="section-title">
            What RepoRescue will not do
          </h2>
          <div className="grid gap-6 md:grid-cols-2" style={{ marginTop: 14 }}>
            <ul className="clean-list">
              <li>
                <span className="bullet bullet-rose" aria-hidden="true" />
                <span>Push a branch, commit or open a pull request. PR output is a clearly labelled preview.</span>
              </li>
              <li>
                <span className="bullet bullet-rose" aria-hidden="true" />
                <span>Run repository code, package installs or lifecycle hooks during analysis.</span>
              </li>
              <li>
                <span className="bullet bullet-rose" aria-hidden="true" />
                <span>Invent CI results, merges or a before/after score without a real re-analysis.</span>
              </li>
            </ul>
            <ul className="clean-list">
              <li>
                <span className="bullet bullet-mint" aria-hidden="true" />
                <span>It does: justify every deduction from scanned evidence with file and line references.</span>
              </li>
              <li>
                <span className="bullet bullet-mint" aria-hidden="true" />
                <span>It does: refuse unsafe fixes (license choice, committed secrets, new test suites) and explain why.</span>
              </li>
              <li>
                <span className="bullet bullet-mint" aria-hidden="true" />
                <span>It does: separate local validation, unavailable checks and remote states in every record.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

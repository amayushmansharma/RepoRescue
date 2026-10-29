import Link from "next/link";
import { listStoredScans } from "@/server/store/scan-store";
import { ModeBadge, formatUtc } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ScanHistoryPage() {
  const scans = await listStoredScans(50);

  return (
    <div className="shell" style={{ paddingTop: 36, paddingBottom: 30 }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">Scan history</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 10 }}>Recorded assessments</h1>
          <p className="muted" style={{ fontSize: 13.4, marginTop: 8, maxWidth: 640 }}>
            Every scan keeps its assessment in PostgreSQL (or in-process storage when the database is unreachable) so the
            workflow can reference the same evidence later. Demo scans are clearly labelled DEMO.
          </p>
        </div>
        <Link className="btn btn-primary" href="/">
          New scan
        </Link>
      </div>

      <div className="glass" style={{ marginTop: 20, overflow: "hidden" }}>
        {scans.length === 0 ? (
          <div className="panel">
            <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
              No scans recorded yet. Start with a bundled demo on the overview page: the whole workflow runs without
              credentials.
            </p>
          </div>
        ) : (
          <div className="scroll-x" tabIndex={0} role="region" aria-label="Scan history table">
            <table className="table">
              <caption className="sr-only">All recorded repository scans</caption>
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Score</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Findings</th>
                  <th scope="col">Storage</th>
                  <th scope="col">Scanned</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr key={scan.scanId}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {scan.repository}
                    </td>
                    <td>
                      <ModeBadge mode={scan.mode} />
                    </td>
                    <td style={{ color: scan.score >= 80 ? "var(--score-high)" : scan.score >= 55 ? "var(--score-mid)" : "var(--score-low)", fontWeight: 600 }}>
                      {scan.score}
                    </td>
                    <td className="mono dim">{scan.coverage}</td>
                    <td className="muted">{scan.findings}</td>
                    <td>
                      <span className={`badge badge-mono ${scan.storage === "database" ? "badge-pass" : "badge-medium"}`}>{scan.storage}</span>
                    </td>
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
    </div>
  );
}

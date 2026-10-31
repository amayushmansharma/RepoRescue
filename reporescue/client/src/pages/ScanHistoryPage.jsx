import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiClientError, api } from "../services/api-client.js";
import { ModeBadge, Notice, Spinner, formatUtc } from "../components/ui.jsx";

function deduplicateScans(scans) {
  if (!Array.isArray(scans)) return [];
  const seenDemo = new Set();
  const deduped = [];
  for (const scan of scans) {
    if (scan.mode === "demo") {
      const repoKey = scan.repository || scan.repositoryUrl;
      if (seenDemo.has(repoKey)) continue;
      seenDemo.add(repoKey);
    }
    deduped.push(scan);
  }
  return deduped;
}

export default function ScanHistoryPage() {
  const [scans, setScans] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listScans()
      .then((payload) => {
        if (!cancelled) setScans(deduplicateScans(payload.scans));
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof ApiClientError ? caught.message : "Scan history could not be loaded.");
        setScans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell" style={{ paddingTop: 36, paddingBottom: 30 }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">Scan history</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 10 }}>Recorded assessments</h1>
          <p className="muted" style={{ fontSize: 13.4, marginTop: 8, maxWidth: 640 }}>
            Every scan keeps its assessment on the server (in memory, mirrored to a bounded JSON file) so the workflow can
            reference the same evidence later. Demo scans are clearly labelled DEMO.
          </p>
        </div>
        <Link className="btn btn-primary" to="/">New scan</Link>
      </div>

      {error ? (
        <div style={{ marginTop: 16 }}>
          <Notice tone="error" title="History unavailable">{error}</Notice>
        </div>
      ) : null}

      <div className="glass" style={{ marginTop: 20, overflow: "hidden" }}>
        {scans === null ? (
          <div className="panel"><Spinner label="Loading scan history…" /></div>
        ) : scans.length === 0 ? (
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
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr key={scan.scanId}>
                    <td className="mono" style={{ fontSize: 12.5 }}>{scan.repository}</td>
                    <td><ModeBadge mode={scan.mode} /></td>
                    <td style={{ color: scan.score >= 80 ? "var(--mint)" : scan.score >= 55 ? "var(--amber)" : "var(--rose)", fontWeight: 600 }}>{scan.score}</td>
                    <td className="mono dim">{scan.coverage}</td>
                    <td className="muted">{scan.findings}</td>
                    <td><span className={`badge badge-mono ${scan.storage === "memory" ? "badge-medium" : "badge-pass"}`}>{scan.storage}</span></td>
                    <td className="dim" style={{ fontSize: 12 }}>{formatUtc(scan.createdAt)}</td>
                    <td><Link className="btn btn-ghost btn-sm" to={`/scan/${scan.scanId}`}>Open</Link></td>
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

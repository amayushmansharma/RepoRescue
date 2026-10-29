import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ApiClientError, api } from "../services/api-client.js";
import { createWorkspaceResources } from "./workspace-resources.js";
import { ModeBadge, Notice, ScoreRing, Spinner } from "../components/ui.jsx";

const ScanContext = createContext(null);

export function useScanWorkspace() {
  const context = useContext(ScanContext);
  if (!context) throw new Error("useScanWorkspace must be used inside ScanWorkspaceProvider");
  return context;
}

const STAGES = [
  { slug: "", label: "Scan", index: "01" },
  { slug: "findings", label: "Find", index: "02" },
  { slug: "fix", label: "Fix", index: "03" },
  { slug: "review", label: "Review", index: "04" },
  { slug: "verify", label: "Verify", index: "05" },
];

function readStoredSelection(scanId, scan) {
  const auto = scan.findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id);
  try {
    const stored = sessionStorage.getItem(`rr-selection:${scanId}`);
    const parsed = stored ? JSON.parse(stored) : null;
    const selection = Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === "string" && scan.findings.some((finding) => finding.id === id))
      : auto;
    const storedId = sessionStorage.getItem(`rr-verification:${scanId}`);
    const verifiedSelection = sessionStorage.getItem(`rr-verification-findings:${scanId}`);
    const matches = verifiedSelection === [...selection].sort().join(",");
    return { selection, verificationId: matches ? storedId : null };
  } catch {
    return { selection: auto, verificationId: null };
  }
}

export function ScanWorkspaceProvider({ children }) {
  const { scanId = "" } = useParams();
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelectedState] = useState([]);
  const selectedRef = useRef([]);
  const [verificationId, setVerificationIdState] = useState(null);
  const initializedFor = useRef(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [resources] = useState(() => createWorkspaceResources());

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    const controller = new AbortController();
    api.getScan(scanId, controller.signal)
      .then((payload) => {
        if (cancelled) return;
        setError(null);
        setScan(payload.scan);
        setLoading(false);
        if (initializedFor.current !== scanId) {
          initializedFor.current = scanId;
          const stored = readStoredSelection(scanId, payload.scan);
          selectedRef.current = stored.selection;
          setSelectedState(stored.selection);
          // A new scan must never inherit the previous scan's verification.
          setVerificationIdState(stored.verificationId);
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        const apiError = caught instanceof ApiClientError ? caught : null;
        setError({ scanId, message: apiError?.message ?? "The scan record could not be loaded.", code: apiError?.code });
        setLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [scanId, reloadToken]);

  // Do not show the old repository while a new scanId is being fetched.
  const visibleScan = scan?.scanId === scanId ? scan : null;
  const currentError = error?.scanId === scanId ? error : null;
  const loadingCurrent = loading || (!visibleScan && !currentError);

  const reload = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    // Without this guard, navigating to a new scan can save the old selection
    // under the new scan ID before its assessment finishes loading.
    if (initializedFor.current !== scanId) return;
    try {
      sessionStorage.setItem(`rr-selection:${scanId}`, JSON.stringify(selected));
    } catch {
      // Selection still works if storage is blocked.
    }
  }, [selected, scanId]);

  const setVerificationId = useCallback((value, findingIds) => {
    if (value && (initializedFor.current !== scanId || (findingIds && [...findingIds].sort().join(",") !== [...selectedRef.current].sort().join(",")))) return false;
    setVerificationIdState(value);
    try {
      if (value) {
        sessionStorage.setItem(`rr-verification:${scanId}`, value);
        sessionStorage.setItem(`rr-verification-findings:${scanId}`, [...selectedRef.current].sort().join(","));
      } else {
        sessionStorage.removeItem(`rr-verification:${scanId}`);
        sessionStorage.removeItem(`rr-verification-findings:${scanId}`);
      }
    } catch {
      // Verification remains usable in the current session.
    }
    return true;
  }, [scanId]);

  function updateSelection(next) {
    const previous = selectedRef.current;
    const selection = typeof next === "function" ? next(previous) : next;
    if (previous.length === selection.length && previous.every((id, index) => id === selection[index])) return;
    selectedRef.current = selection;
    setSelectedState(selection);
    // A local re-analysis only proves things about its original selection.
    setVerificationId(null);
  }

  const value = {
    resources,
    scanId,
    scan: visibleScan,
    loading: loadingCurrent,
    error: currentError,
    reload,
    selected,
    selectedSet: new Set(selected),
    autoIds: visibleScan ? visibleScan.findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id) : [],
    toggle: (id) => updateSelection((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]),
    setSelected: updateSelection,
    selectAllAuto: () => updateSelection(visibleScan ? visibleScan.findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id) : []),
    clearSelection: () => updateSelection([]),
    verificationId,
    setVerificationId,
  };

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function WorkspaceShell({ children }) {
  const { scan, loading, error, reload, selected } = useScanWorkspace();
  const { pathname } = useLocation();
  const base = scan ? `/scan/${scan.scanId}` : "";
  const currentSlug = scan ? pathname.replace(base, "").replace(/^\//, "") : "";
  const pips = scan ? Math.max(1, Math.min(5, Math.ceil(scan.score.total / 20))) : 0;
  const pipTone = scan && scan.score.total < 55 ? "is-bad" : scan && scan.score.total < 80 ? "is-warn" : "is-filled";

  return (
    <div className="shell" style={{ paddingTop: 24, paddingBottom: 34 }}>
      {error ? (
        <div className="glass panel">
          <Notice tone="error" title={error.code ? `Scan unavailable — ${error.code}` : "Scan unavailable"}>
            {error.message}
          </Notice>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={reload}>Retry</button>
            <Link className="btn btn-ghost btn-sm" to="/">Start a new scan</Link>
          </div>
        </div>
      ) : loading ? (
        <div className="glass panel" aria-live="polite" style={{ display: "grid", gap: 12 }}>
          <Spinner label="Loading the assessment…" />
          <p className="dim" style={{ fontSize: 12.5 }}>
            The scan remains on the server. Review shows only the evidence and proposed files you select.
          </p>
        </div>
      ) : scan ? (
        <div className="workspace-layout">
          <aside className="workspace-rail" aria-label="Repository context and workflow stages">
            <div className="repo-console">
              <div className="repo-console-label"><span>Active repository</span><span aria-hidden="true">●</span></div>
              <span className="repo-console-name">{scan.repository.fullName}</span>
              <div className="flex flex-wrap gap-1.5" style={{ marginTop: 9 }}>
                <ModeBadge mode={scan.mode} fixture={scan.repository.fixture} />
                <span className="badge badge-mono">{scan.ecosystem.id}</span>
              </div>
              <div className="health-pips" role="img" aria-label={`Readiness health: ${pips} of 5 pips filled`}>
                {Array.from({ length: 5 }, (_, index) => (
                  <span key={index} className={`health-pip ${index < pips ? pipTone : ""}`} aria-hidden="true" />
                ))}
              </div>
              <p className="mono dim" style={{ fontSize: 10.5, marginTop: 7 }}>
                readiness {scan.score.total}/100 · coverage {scan.score.coverage}
              </p>
            </div>

            <nav className="workspace-stage-nav" aria-label="RepoRescue workflow stages">
              {STAGES.map((stage) => {
                const href = stage.slug ? `${base}/${stage.slug}` : base;
                const active = currentSlug === stage.slug;
                return (
                  <Link key={stage.slug || "scan"} to={href} className="workspace-stage-link" aria-current={active ? "page" : undefined}>
                    <span className="workspace-stage-index">{stage.index}</span>
                    <span>{stage.label}</span>
                    <span className="workspace-stage-arrow" aria-hidden="true">›</span>
                  </Link>
                );
              })}
            </nav>

            <div className="repo-console" style={{ padding: 13 }}>
              <div className="flex items-center gap-3">
                <ScoreRing score={scan.score.total} size={64} label="health" />
                <div>
                  <p className="terminal-kicker">Selection queue</p>
                  <p className="mono" style={{ marginTop: 5, fontSize: 12.5 }}>{selected.length} finding{selected.length === 1 ? "" : "s"}</p>
                  <Link className="mono" to={`${base}/findings`} style={{ fontSize: 10.5, color: "var(--text-soft)" }}>
                    manage selection →
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-ghost btn-sm" to="/">← New scan</Link>
              <a className="btn btn-ghost btn-sm" href="/api/health" target="_blank" rel="noreferrer">System</a>
            </div>
          </aside>

          {/* A single CSS curtain restarts only for a different scan or stage. */}
          <div className="workspace-content" key={`${scan.scanId}:${currentSlug}`}>
            <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 16 }}>
              <p className="terminal-kicker">Scan {scan.scanId.slice(0, 8)} · {scan.status.replaceAll("-", " ")}</p>
              <span className="mono dim" style={{ fontSize: 10.5 }}>read-only analysis · no remote writes</span>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

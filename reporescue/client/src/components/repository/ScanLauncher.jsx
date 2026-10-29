import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiClientError, api } from "../../services/api-client.js";
import { Notice, Spinner } from "../ui.jsx";
const POLL_INTERVAL_MS = 500;
const MAX_PROGRESS_POLLS = 240; // A bounded observation budget; never a progress estimate.
function newProgressId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        return crypto.randomUUID();
    // Shape-only fallback; the server ignores ids it cannot validate.
    return "00000000-0000-4000-8000-000000000000";
}
export function ScanLauncher({ demos }) {
    const navigate = useNavigate();
    const [repository, setRepository] = useState("");
    const [phase, setPhase] = useState({ kind: "idle" });
    const [error, setError] = useState(null);
    const [inputError, setInputError] = useState(null);
    const [progress, setProgress] = useState(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const requestRef = useRef(null);
    const pollRef = useRef(null);
    const timerRef = useRef(null);
    const busy = phase.kind !== "idle";
    // An honest elapsed clock while a request is in flight.
    useEffect(() => {
        if (!busy)
            return;
        const started = Date.now();
        const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 200);
        return () => window.clearInterval(timer);
    }, [busy]);
    function stopProgress() {
        pollRef.current?.abort();
        pollRef.current = null;
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = null;
    }
    useEffect(() => () => {
        requestRef.current?.abort();
        requestRef.current = null;
        stopProgress();
    }, []);
    function watchProgress(progressId, scanRequest) {
        stopProgress();
        const controller = new AbortController();
        pollRef.current = controller;
        let attempts = 0;
        const current = () => !controller.signal.aborted && !scanRequest.signal.aborted && requestRef.current === scanRequest;
        const poll = async () => {
            if (!current()) return;
            attempts += 1;
            let again = true;
            try {
                const snapshot = await api.getScanProgress(progressId, controller.signal);
                if (!current()) return;
                setProgress((previous) => {
                    const last = (value) => value?.phases.at(-1)?.at;
                    return previous?.status === snapshot.status && previous.phases.length === snapshot.phases.length && last(previous) === last(snapshot)
                        ? previous : snapshot;
                });
                again = snapshot.status === "running";
            } catch (caught) {
                if (!current()) return;
                // A first-poll 404 can race with POST acceptance. Retry briefly;
                // progress is observability only and never determines scan success.
                again = !(caught instanceof ApiClientError) || caught.code === "NOT_FOUND" || caught.code === "NETWORK_ERROR";
            }
            if (again && current() && attempts < MAX_PROGRESS_POLLS) {
                timerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
            }
        };
        void poll();
    }
    async function executeScan(mode, target) {
        if (requestRef.current) return;
        const progressId = newProgressId();
        const controller = new AbortController();
        requestRef.current = controller;
        setError(null);
        setInputError(null);
        setProgress(null);
        setElapsedMs(0);
        setPhase(mode === "demo" ? { kind: "demo", id: target } : { kind: "live" });
        try {
            const pending = mode === "demo"
                ? api.createDemoScan(target, progressId, controller.signal)
                : api.createLiveScan(target, progressId, controller.signal);
            watchProgress(progressId, controller);
            const payload = await pending;
            if (controller.signal.aborted || requestRef.current !== controller) return;
            setPhase({ kind: "idle" });
            navigate(`/scan/${payload.scan.scanId}`);
        } catch (caught) {
            if (controller.signal.aborted || requestRef.current !== controller) return;
            const apiError = caught instanceof ApiClientError ? caught : null;
            setError({
                message: apiError?.message ?? "The scan could not be completed. Check the repository identifier and try again, or use a demo repository.",
                code: apiError?.code,
                retryAfterSeconds: apiError?.retryAfterSeconds,
            });
            setPhase({ kind: "idle" });
        } finally {
            if (requestRef.current === controller) {
                stopProgress();
                requestRef.current = null;
            }
        }
    }
    async function startLiveScan(event) {
        event.preventDefault();
        setError(null);
        const value = repository.trim();
        if (!value) {
            setInputError("Enter a repository URL or owner/repository.");
            return;
        }
        if (value.length > 300) {
            setInputError("That input is too long to be a repository identifier.");
            return;
        }
        if (!/(^|[\s/@:])[\w.-]+\/[\w.-]+/.test(value) && !/github\.com/i.test(value)) {
            setInputError("Use a GitHub URL or the owner/repository form, for example octocat/hello-world.");
            return;
        }
        await executeScan("live", value);
    }
    function startDemoScan(demoId) {
        void executeScan("demo", demoId);
    }
    const recorded = busy ? (progress?.phases ?? []) : [];
    const activePhase = recorded.length > 0 ? recorded[recorded.length - 1] : null;
    return (<div className="glass panel" style={{ padding: 20 }}>
      <div className="flex items-center justify-between gap-3">
        <h2 style={{ fontSize: "1.02rem" }}>Start a scan</h2>
        <span className="badge badge-mono">no account required</span>
      </div>

      <form onSubmit={startLiveScan} noValidate style={{ marginTop: 16 }}>
        <label className="field-label" htmlFor="repository-input">
          Public GitHub repository
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="repository-input" className="input" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://github.com/owner/repository" value={repository} onChange={(event) => { setRepository(event.target.value); if (inputError) setInputError(null); }} aria-invalid={inputError ? "true" : undefined} aria-describedby={inputError ? "repository-help repository-error" : "repository-help"} disabled={busy}/>
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={phase.kind === "live"}>
            {phase.kind === "live" ? "Scanning…" : "Scan repository"}
          </button>
        </div>
        <p id="repository-help" className="dim" style={{ fontSize: 12, marginTop: 7 }}>
          Read-only GitHub API access. Public repositories only; a server-side token is optional.
        </p>
        {inputError ? (<p id="repository-error" role="alert" style={{ color: "var(--tone-bad)", fontSize: 12.5, marginTop: 7 }}>
            {inputError}
          </p>) : null}
      </form>

      <div className="divider" style={{ margin: "18px 0" }}/>

      <div className="flex items-center justify-between gap-3">
        <h3 style={{ fontSize: "0.92rem" }}>Or explore a bundled demo</h3>
        <span className="badge badge-demo badge-mono">deterministic</span>
      </div>
      <p className="dim" style={{ fontSize: 12.3, marginTop: 6, lineHeight: 1.6 }}>
        Demo repositories are fixtures that run through the same analysis engine. Nothing is fetched from GitHub and no
        credentials are needed.
      </p>

      <div className="grid gap-3" style={{ marginTop: 12 }}>
        {demos.map((demo) => (<button key={demo.id} type="button" className="demo-card" onClick={() => startDemoScan(demo.id)} disabled={busy} aria-label={`Scan the bundled ${demo.label} demo repository`}>
            <div className="flex items-center justify-between gap-3">
              <span className="mono" style={{ fontSize: 12.5, color: "var(--text)" }}>
                {demo.repository}
              </span>
              <span className="badge badge-mono">{demo.ecosystem}</span>
            </div>
            <span style={{ fontSize: 12.8, color: "var(--text-muted)", lineHeight: 1.55 }}>{demo.description}</span>
            <span className="flex items-center justify-between gap-3">
              <span className="dim mono" style={{ fontSize: 11 }}>
                {phase.kind === "demo" && phase.id === demo.id ? "opening workspace…" : "open demo scan →"}
              </span>
              {phase.kind === "demo" && phase.id === demo.id ? <Spinner label="Scanning fixture"/> : null}
            </span>
          </button>))}
      </div>

{busy ? (<div className="scan-stage" style={{ marginTop: 18 }}>
           <div className="scan-stage-copy">
            <p className="eyebrow">{phase.kind === "demo" ? "Demo scan · bundled fixture" : "Live scan · read-only GitHub"}</p>
<p className="scan-phase-title" style={{ marginTop: 6 }} role="status" aria-live="polite" aria-atomic="true">
               {activePhase ? activePhase.label : "Waiting for the analysis API to report its first phase…"}
            </p>
            <p className="dim" style={{ fontSize: 11.8, marginTop: 6, lineHeight: 1.55 }}>
              {(elapsedMs / 1000).toFixed(1)}s elapsed · {recorded.length} step
              {recorded.length === 1 ? "" : "s"} recorded by the server
            </p>
            {recorded.length > 0 ? (<ul className="scan-phase-list">
                {recorded.slice(-6).map((entry, index, list) => {
                    const state = progress?.status === "complete" || index < list.length - 1 ? "done" : progress?.status === "failed" ? "failed" : "active";
                    return (<li key={`${entry.key}-${entry.at}`} data-state={state}>
                      <span className="scan-phase-dot" aria-hidden="true">
                        {state === "done" ? "✓" : state === "failed" ? "×" : "●"}
                      </span>
                      <span>{entry.label}</span>
                    </li>);
                })}
              </ul>) : (<p className="dim" style={{ fontSize: 11.8, marginTop: 8 }}>
                Waiting for the server’s first phase. A completion percentage is not available.
              </p>)}
            <div className="scan-phase-meter" aria-hidden="true">
              {recorded.map((entry) => (<span key={entry.at} data-filled="true"/>))}
            </div>
            <p className="dim" style={{ fontSize: 11.4, marginTop: 8 }}>
              Each bar represents a phase recorded by the server.
            </p>
          </div>
        </div>) : null}

      {error ? (<div style={{ marginTop: 16 }}>
          <Notice tone="error" title={error.code ? `Scan failed — ${error.code}` : "Scan failed"}>
            {error.message}
            {error.retryAfterSeconds ? (<div style={{ marginTop: 4 }}>GitHub asks you to retry in about {error.retryAfterSeconds} seconds.</div>) : null}
            <div style={{ marginTop: 6 }}>
              Recovery: check the owner/repository spelling, try a smaller public repository, or continue with a bundled
              demo.
            </div>
          </Notice>
        </div>) : null}
    </div>);
}

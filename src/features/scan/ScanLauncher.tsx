"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DemoRepository, ScanProgress } from "@/lib/types";
import { ApiClientError, api } from "@/lib/api-client";
import { Notice, Spinner } from "@/components/ui";

type Phase = { kind: "idle" } | { kind: "live" } | { kind: "demo"; id: string };

const POLL_INTERVAL_MS = 130;

function newProgressId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Shape-only fallback; the server ignores ids it cannot validate.
  return "00000000-0000-4000-8000-000000000000";
}

export function ScanLauncher({ demos }: { demos: DemoRepository[] }) {
  const router = useRouter();
  const [repository, setRepository] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<{ message: string; code?: string; retryAfterSeconds?: number } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const pollRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const busy = phase.kind !== "idle";

  // An honest elapsed clock while a request is in flight.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 200);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(
    () => () => {
      pollRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function watchProgress(progressId: string) {
    pollRef.current?.abort();
    const controller = new AbortController();
    pollRef.current = controller;

    const poll = async () => {
      try {
        const snapshot = await api.getScanProgress(progressId, controller.signal);
        setProgress(snapshot);
        if (snapshot.status === "running") timerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (caught) {
        // Progress is observability only: a failed poll must never break a scan.
        if (caught instanceof DOMException && caught.name === "AbortError") return;
      }
    };
    void poll();
  }

  async function startLiveScan(event: React.FormEvent<HTMLFormElement>) {
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
    setInputError(null);
    const progressId = newProgressId();
    setProgress(null);
    setElapsedMs(0);
    setPhase({ kind: "live" });
    watchProgress(progressId);
    try {
      const payload = await api.createLiveScan(value, progressId);
      pollRef.current?.abort();
      setPhase({ kind: "idle" });
      router.push(`/scan/${payload.scan.scanId}`);
    } catch (caught) {
      const apiError = caught instanceof ApiClientError ? caught : null;
      setError({
        message:
          apiError?.message ??
          "The scan could not be completed. Check the repository identifier and try again, or use a demo repository.",
        code: apiError?.code,
        retryAfterSeconds: apiError?.retryAfterSeconds,
      });
      setPhase({ kind: "idle" });
    }
  }

  async function startDemoScan(demoId: string) {
    setError(null);
    setInputError(null);
    const progressId = newProgressId();
    setProgress(null);
    setElapsedMs(0);
    setPhase({ kind: "demo", id: demoId });
    watchProgress(progressId);
    try {
      const payload = await api.createDemoScan(demoId, progressId);
      pollRef.current?.abort();
      setPhase({ kind: "idle" });
      router.push(`/scan/${payload.scan.scanId}`);
    } catch (caught) {
      const apiError = caught instanceof ApiClientError ? caught : null;
      setError({ message: apiError?.message ?? "The demo scan could not be started.", code: apiError?.code });
      setPhase({ kind: "idle" });
    }
  }

  const recorded = busy ? (progress?.phases ?? []) : [];
  const activePhase = recorded.length > 0 ? recorded[recorded.length - 1] : null;

  return (
    <div className="glass panel" style={{ padding: 20 }}>
      <div className="flex items-center justify-between gap-3">
        <h2 style={{ fontSize: "1.02rem" }}>Start a scan</h2>
        <span className="badge badge-mono">no account required</span>
      </div>

      <form onSubmit={startLiveScan} noValidate style={{ marginTop: 16 }}>
        <label className="field-label" htmlFor="repository-input">
          Public GitHub repository
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="repository-input"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/owner/repository"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            aria-invalid={inputError ? "true" : undefined}
            aria-describedby="repository-help"
            disabled={busy}
          />
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={phase.kind === "live"}>
            {phase.kind === "live" ? "Scanning…" : "Scan repository"}
          </button>
        </div>
        <p id="repository-help" className="dim" style={{ fontSize: 12, marginTop: 7 }}>
          Read-only GitHub API access. Public repositories only; a server-side token is optional.
        </p>
        {inputError ? (
          <p role="alert" style={{ color: "var(--tone-bad)", fontSize: 12.5, marginTop: 7 }}>
            {inputError}
          </p>
        ) : null}
      </form>

      <div className="divider" style={{ margin: "18px 0" }} />

      <div className="flex items-center justify-between gap-3">
        <h3 style={{ fontSize: "0.92rem" }}>Or explore a bundled demo</h3>
        <span className="badge badge-demo badge-mono">deterministic</span>
      </div>
      <p className="dim" style={{ fontSize: 12.3, marginTop: 6, lineHeight: 1.6 }}>
        Demo repositories are fixtures that run through the same analysis engine. Nothing is fetched from GitHub and no
        credentials are needed.
      </p>

      <div className="grid gap-3" style={{ marginTop: 12 }}>
        {demos.map((demo) => (
          <button
            key={demo.id}
            type="button"
            className="demo-card"
            onClick={() => startDemoScan(demo.id)}
            disabled={busy}
            aria-label={`Scan the bundled ${demo.label} demo repository`}
          >
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
              {phase.kind === "demo" && phase.id === demo.id ? <Spinner label="Scanning fixture" /> : null}
            </span>
          </button>
        ))}
      </div>

      {busy ? (
        <div className="scan-stage" style={{ marginTop: 18 }}>
          <div className="scan-stage-copy">
            <p className="eyebrow">{phase.kind === "demo" ? "Demo scan · bundled fixture" : "Live scan · read-only GitHub"}</p>
            <p className="scan-phase-title" style={{ marginTop: 6 }} role="status" aria-live="polite" aria-atomic="true">
              {activePhase ? activePhase.label : "Waiting for the analysis API to report its first phase…"}
            </p>
            <p className="dim" style={{ fontSize: 11.8, marginTop: 6, lineHeight: 1.55 }}>
              {(elapsedMs / 1000).toFixed(1)}s elapsed · {recorded.length} step
              {recorded.length === 1 ? "" : "s"} recorded by the server
            </p>
            {recorded.length > 0 ? (
              <ul className="scan-phase-list">
                {recorded.slice(-6).map((entry, index, list) => {
                  const state = index === list.length - 1 ? "active" : "done";
                  return (
                    <li key={`${entry.key}-${entry.at}`} data-state={state}>
                      <span className="scan-phase-dot" aria-hidden="true">
                        {state === "done" ? "✓" : "●"}
                      </span>
                      <span>{entry.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="dim" style={{ fontSize: 11.8, marginTop: 8 }}>
                Waiting for the server’s first phase. A completion percentage is not available.
              </p>
            )}
            <div className="scan-phase-meter" aria-hidden="true">
              {recorded.map((entry) => (
                <span key={entry.at} data-filled="true" />
              ))}
            </div>
            <p className="dim" style={{ fontSize: 11.4, marginTop: 8 }}>
              Each bar represents a phase recorded by the server.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 16 }}>
          <Notice tone="error" title={error.code ? `Scan failed — ${error.code}` : "Scan failed"}>
            {error.message}
            {error.retryAfterSeconds ? (
              <div style={{ marginTop: 4 }}>GitHub asks you to retry in about {error.retryAfterSeconds} seconds.</div>
            ) : null}
            <div style={{ marginTop: 6 }}>
              Recovery: check the owner/repository spelling, try a smaller public repository, or continue with a bundled
              demo.
            </div>
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

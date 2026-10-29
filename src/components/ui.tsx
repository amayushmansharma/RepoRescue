import type { ReactNode } from "react";
import type { Confidence, Severity, ValidationState, VerificationCheckState, ScanMode } from "@/lib/types";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge-${severity} badge-mono`}>{severity}</span>;
}

export function ModeBadge({ mode, fixture }: { mode: ScanMode; fixture?: boolean }) {
  if (mode === "demo") {
    return (
      <span className="badge badge-demo badge-mono" title="Bundled deterministic fixture, not a live GitHub repository">
        demo · fixture
      </span>
    );
  }
  return (
    <span className="badge badge-live badge-mono" title={fixture ? "Metadata came from a fixture" : "Retrieved from the GitHub REST API"}>
      live scan
    </span>
  );
}

export function ValidationBadge({ state }: { state: ValidationState | VerificationCheckState }) {
  const cls = state === "passed" ? "badge-pass" : state === "failed" ? "badge-fail" : "badge-skip";
  return <span className={`badge ${cls} badge-mono`}>{state.replace("-", " ")}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={`badge badge-mono ${confidence === "confirmed" ? "badge-pass" : "badge-medium"}`} title={
      confidence === "confirmed" ? "Direct evidence in scanned files or metadata" : "Evidence needs human confirmation"
    }>
      {confidence === "confirmed" ? "confirmed" : "needs review"}
    </span>
  );
}

export function ScoreRing({
  score,
  coverage,
  size = 132,
  label = "readiness",
}: {
  score: number;
  coverage?: number;
  size?: number;
  label?: string;
}) {
  const radius = size / 2 - 9;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const tone = score >= 80 ? "var(--text)" : score >= 55 ? "var(--lavender)" : "var(--grey-500)";
  return (
    <div style={{ position: "relative", width: size, height: size }} role="img" aria-label={`${label} score ${score} out of 100${coverage ? `, coverage ${coverage} of 100 weight points` : ""}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="7"
          className="ring-arc"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div style={{ fontSize: size * 0.27, fontWeight: 650, letterSpacing: "-0.04em", lineHeight: 1 }}>{score}</div>
          <div className="mono" style={{ fontSize: 9.5, color: "var(--text-dim-on-glass)", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>
            {label}
          </div>
          {coverage !== undefined ? (
            <div className="mono" style={{ fontSize: 9.5, color: "var(--text-dim-on-glass)" }}>
              {coverage}/100 coverage
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: "warn" | "bad" }) {
  return (
    <div className="meter" data-tone={tone ?? undefined} role="presentation">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error" | "ok";
  title?: string;
  children: ReactNode;
}) {
  const cls = tone === "error" ? "alert-error" : tone === "warn" ? "alert-warn" : tone === "ok" ? "alert-ok" : "alert-info";
  return (
    <div className={`alert ${cls}`} role={tone === "error" ? "alert" : "status"}>
      <span aria-hidden="true" style={{ fontSize: 13, lineHeight: "20px" }}>
        {tone === "error" ? "✕" : tone === "warn" ? "!" : tone === "ok" ? "✓" : "i"}
      </span>
      <div>
        {title ? (
          <strong style={{ display: "block", marginBottom: 3, fontWeight: 600 }}>{title}</strong>
        ) : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="rgba(166,104,255,0.55)" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--mint)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="muted" style={{ fontSize: 12.5 }}>
        {label}
      </span>
    </span>
  );
}

export function DiffView({
  path,
  diff,
  changeType,
  additions,
  deletions,
}: {
  path: string;
  diff: string;
  changeType: "create" | "modify";
  additions?: number;
  deletions?: number;
}) {
  const lines = diff.split("\n");
  return (
    <figure className="diff" style={{ margin: 0 }} aria-label={`Unified diff for ${path}`}>
      <figcaption className="diff-head">
        <span className="mono" style={{ color: "var(--text)" }}>
          {path}
        </span>
        <span className="flex items-center gap-2">
          <span className="badge badge-mono">{changeType === "create" ? "new file" : "modified"}</span>
          {additions !== undefined ? (
            <span className="mono" style={{ fontSize: 11 }}>
              <span style={{ color: "var(--mint)" }}>+{additions}</span> <span style={{ color: "var(--rose)" }}>−{deletions ?? 0}</span>
            </span>
          ) : null}
        </span>
      </figcaption>
      <div className="diff-body">
        {lines.map((line, index) => {
          const meta = /^(---|\+\+\+|@@|diff --git|index )/.test(line);
          const add = !meta && line.startsWith("+");
          const del = !meta && line.startsWith("-");
          const cls = meta ? "diff-meta" : add ? "diff-add" : del ? "diff-del" : "diff-ctx";
          const sign = meta ? "" : add ? "+" : del ? "−" : "";
          return (
            <div key={`${index}-${line.slice(0, 12)}`} className={`diff-line ${cls}`}>
              <span className="sign" aria-hidden="true">
                {sign}
              </span>
              <span>
                <span className="sr-only">{add ? "added line: " : del ? "removed line: " : ""}</span>
                {line || " "}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function Checklist({ items }: { items: { label: string; done: boolean; note?: string }[] }) {
  return (
    <ul className="clean-list">
      {items.map((item) => (
        <li key={item.label}>
          <span
            aria-hidden="true"
            className="mono"
            style={{ color: item.done ? "var(--mint)" : "var(--text-dim)", width: 16, flex: "0 0 16px" }}
          >
            {item.done ? "☑" : "☐"}
          </span>
          <span>
            <span className="sr-only">{item.done ? "Done: " : "Outstanding: "}</span>
            <span style={{ color: item.done ? "var(--text)" : "var(--text-muted)" }}>{item.label}</span>
            {item.note ? (
              <span className="dim" style={{ display: "block", fontSize: 12 }}>
                {item.note}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4" style={{ padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span className="dim mono" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", paddingTop: 2 }}>
        {label}
      </span>
      <span className="status-value" style={{ textAlign: "right", fontSize: 13 }}>{children}</span>
    </div>
  );
}

export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function titleCase(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

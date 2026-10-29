/**
 * Server-side scan progress.
 *
 * The UI must never invent progress. Instead the scan services publish the
 * phases they actually perform, keyed by a client-generated id, and the client
 * polls this store while its request is in flight. When no id is supplied (or
 * it has expired) the UI falls back to a non-specific "working" state.
 *
 * Bounded and TTL'd: this is observability, not persistence.
 */

export type ScanPhaseKey =
  | "accepted"
  | "normalising-input"
  | "fetching-metadata"
  | "discovering-files"
  | "normalising-content"
  | "running-rules"
  | "calculating-score"
  | "saving-assessment"
  | "complete"
  | "failed";

export const PHASE_LABELS: Record<ScanPhaseKey, string> = {
  accepted: "Request accepted by the analysis API",
  "normalising-input": "Validating and normalising the repository identifier",
  "fetching-metadata": "Fetching repository metadata from GitHub",
  "discovering-files": "Discovering the files the rules need",
  "normalising-content": "Normalising repository contents",
  "running-rules": "Running the 21 deterministic checks",
  "calculating-score": "Calculating the readiness score",
  "saving-assessment": "Saving the assessment",
  complete: "Assessment ready",
  failed: "Scan failed",
};

type ProgressEntry = {
  phases: { key: ScanPhaseKey; at: string }[];
  status: "running" | "complete" | "failed";
  startedAt: number;
  expiresAt: number;
};

const MAX_ENTRIES = 200;
const TTL_MS = 120_000;
const store = new Map<string, ProgressEntry>();
const PROGRESS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function prune(now: number): void {
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function isValidProgressId(id: unknown): id is string {
  return typeof id === "string" && PROGRESS_ID_PATTERN.test(id);
}

export function beginProgress(id: string): void {
  if (!isValidProgressId(id)) return;
  const now = Date.now();
  prune(now);
  store.set(id, { phases: [], status: "running", startedAt: now, expiresAt: now + TTL_MS });
}

export function markProgress(id: string | undefined, key: ScanPhaseKey): void {
  if (!isValidProgressId(id)) return;
  const entry = store.get(id);
  if (!entry || entry.status !== "running") return;
  // Ignore duplicate consecutive phases so the timeline stays truthful.
  const last = entry.phases[entry.phases.length - 1];
  if (last && last.key === key) return;
  entry.phases.push({ key, at: new Date().toISOString() });
  entry.expiresAt = Date.now() + TTL_MS;
}

export function finishProgress(id: string | undefined, status: "complete" | "failed"): void {
  if (!isValidProgressId(id)) return;
  const entry = store.get(id);
  if (!entry) return;
  entry.status = status;
  entry.phases.push({ key: status === "complete" ? "complete" : "failed", at: new Date().toISOString() });
  entry.expiresAt = Date.now() + TTL_MS;
}

export type ProgressSnapshot = {
  id: string;
  status: "running" | "complete" | "failed";
  phases: { key: ScanPhaseKey; label: string; at: string }[];
  elapsedMs: number;
};

export function readProgress(id: unknown): ProgressSnapshot | null {
  if (!isValidProgressId(id)) return null;
  const entry = store.get(id);
  if (!entry) return null;
  return {
    id,
    status: entry.status,
    phases: entry.phases.map((phase) => ({ key: phase.key, label: PHASE_LABELS[phase.key], at: phase.at })),
    elapsedMs: Date.now() - entry.startedAt,
  };
}

export function progressPhaseLabel(key: ScanPhaseKey): string {
  return PHASE_LABELS[key];
}

/** Test helper. */
export function resetProgressStore(): void {
  store.clear();
}

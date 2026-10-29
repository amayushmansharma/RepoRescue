/**
 * Server-side scan progress.
 *
 * The UI must never invent progress. Scan services publish the phases they
 * actually perform, keyed by a client-generated id, and the client polls this
 * store while its POST /api/scans request is in flight. Without a valid id (or
 * once it expires) the UI falls back to a non-specific "working" state.
 *
 * Bounded and TTL'd: observability, not persistence.
 */

export const PHASE_LABELS = {
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

const MAX_ENTRIES = 200;
const TTL_MS = 120_000;
const PROGRESS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const store = new Map();

function prune(now) {
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function isValidProgressId(id) {
  return typeof id === "string" && PROGRESS_ID_PATTERN.test(id);
}

export function beginProgress(id) {
  if (!isValidProgressId(id)) return;
  const now = Date.now();
  prune(now);
  store.set(id, { phases: [], status: "running", startedAt: now, expiresAt: now + TTL_MS });
}

export function markProgress(id, key) {
  if (!isValidProgressId(id)) return;
  const entry = store.get(id);
  if (!entry || entry.status !== "running") return;
  const last = entry.phases[entry.phases.length - 1];
  // Ignore duplicate consecutive phases so the timeline stays truthful.
  if (last && last.key === key) return;
  entry.phases.push({ key, at: new Date().toISOString() });
  entry.expiresAt = Date.now() + TTL_MS;
}

export function finishProgress(id, status) {
  if (!isValidProgressId(id)) return;
  const entry = store.get(id);
  if (!entry) return;
  entry.status = status;
  entry.phases.push({ key: status === "complete" ? "complete" : "failed", at: new Date().toISOString() });
  entry.expiresAt = Date.now() + TTL_MS;
}

export function readProgress(id) {
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

/** Test helper. */
export function resetProgressStore() {
  store.clear();
}

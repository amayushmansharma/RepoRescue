import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight scan/verification storage.
 *
 * Persistence exists for two product reasons only: a scan must survive the
 * FIND → FIX → REVIEW → VERIFY navigation, and verification evidence must be
 * retrievable by id. An in-memory map is the primary store; when enabled, the
 * same records are mirrored to a bounded JSON file so a restart does not lose
 * them. No database is required for any part of the workflow.
 *
 * Configuration (see .env.example):
 *   REPORESCUE_PERSIST   "false" disables the JSON mirror (used in tests)
 *   REPORESCUE_DATA_DIR  directory for scans.json / verifications.json
 */

const MAX_SCANS = 50;
const MAX_VERIFICATIONS = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(here, "../../data");

const scans = new Map();
const verifications = new Map();
let loaded = false;
let persistenceWarned = false;

function persistenceEnabled() {
  return process.env.REPORESCUE_PERSIST !== "false";
}

function dataDir() {
  return process.env.REPORESCUE_DATA_DIR ? path.resolve(process.env.REPORESCUE_DATA_DIR) : defaultDataDir;
}

async function readJsonFile(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!persistenceEnabled()) return;
  const dir = dataDir();
  for (const record of await readJsonFile(path.join(dir, "scans.json"))) {
    if (record && typeof record.scanId === "string") scans.set(record.scanId, record);
  }
  for (const record of await readJsonFile(path.join(dir, "verifications.json"))) {
    if (record && typeof record.id === "string") verifications.set(record.id, record);
  }
}

async function writeJsonFile(file, value) {
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, file);
}

function prune(map, max, key) {
  if (map.size <= max) return;
  const ordered = Array.from(map.values()).sort((a, b) => String(b[key]).localeCompare(String(a[key])));
  for (const record of ordered.slice(max)) map.delete(record.scanId ?? record.id);
}

async function flush() {
  if (!persistenceEnabled()) return "memory";
  try {
    const dir = dataDir();
    await writeJsonFile(path.join(dir, "scans.json"), Array.from(scans.values()));
    await writeJsonFile(path.join(dir, "verifications.json"), Array.from(verifications.values()));
    return "file";
  } catch (error) {
    if (!persistenceWarned) {
      persistenceWarned = true;
      console.warn("[reporescue] JSON persistence unavailable; continuing with in-process storage:", error instanceof Error ? error.message : "unknown");
    }
    return "memory";
  }
}

export async function saveScan(assessment) {
  await ensureLoaded();
  scans.set(assessment.scanId, { ...assessment, storage: persistenceEnabled() ? "file" : "memory" });
  prune(scans, MAX_SCANS, "createdAt");
  const storage = await flush();
  const stored = scans.get(assessment.scanId);
  if (stored && stored.storage !== storage) scans.set(assessment.scanId, { ...stored, storage });
  return storage;
}

export async function getStoredScan(scanId) {
  await ensureLoaded();
  if (!UUID_PATTERN.test(scanId)) return null;
  const assessment = scans.get(scanId);
  return assessment ? { assessment, storage: assessment.storage } : null;
}

export async function listStoredScans(limit = 12) {
  await ensureLoaded();
  return Array.from(scans.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((assessment) => ({
      scanId: assessment.scanId,
      repository: assessment.repository.fullName,
      repositoryUrl: assessment.repository.url,
      mode: assessment.mode,
      status: assessment.status,
      score: assessment.score.total,
      coverage: Math.round(assessment.score.coverage),
      findings: assessment.summary.totalFindings,
      createdAt: assessment.createdAt,
      storage: assessment.storage,
    }));
}

export async function saveVerification(record) {
  await ensureLoaded();
  verifications.set(record.id, record);
  prune(verifications, MAX_VERIFICATIONS, "createdAt");
  return flush();
}

export async function getVerification(verificationId) {
  await ensureLoaded();
  if (!UUID_PATTERN.test(verificationId)) return null;
  return verifications.get(verificationId) ?? null;
}

export async function storageStatus() {
  await ensureLoaded();
  if (!persistenceEnabled()) return { mode: "memory", detail: "in-process only (REPORESCUE_PERSIST=false)" };
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.access(dataDir());
    return { mode: "file", detail: `JSON mirror in ${path.basename(dataDir())}/ (bounded to ${MAX_SCANS} scans)` };
  } catch {
    return { mode: "memory", detail: "JSON mirror unavailable; in-process storage only" };
  }
}

/** Test helper: clears in-memory state without touching disk. */
export function __resetStoreForTests() {
  scans.clear();
  verifications.clear();
  loaded = false;
}

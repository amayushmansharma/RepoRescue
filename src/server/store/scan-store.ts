import { desc, eq } from "drizzle-orm";
import type { ScanHistoryItem, StoredAssessment, VerificationRecord } from "@/lib/types";
import { scans, verifications } from "@/db/schema";

export type Storage = "database" | "memory";

const globalForStore = globalThis as typeof globalThis & {
  __repoRescueScans?: Map<string, { assessment: StoredAssessment; createdAt: string }>;
  __repoRescueVerifications?: Map<string, VerificationRecord>;
  __repoRescueDbWarned?: boolean;
};

function memoryScans() {
  globalForStore.__repoRescueScans ??= new Map();
  return globalForStore.__repoRescueScans;
}

function memoryVerifications() {
  globalForStore.__repoRescueVerifications ??= new Map();
  return globalForStore.__repoRescueVerifications;
}

async function database() {
  if (!process.env.DATABASE_URL) return null;
  try {
    const databaseModule = await import("@/db");
    return databaseModule.db;
  } catch {
    if (!globalForStore.__repoRescueDbWarned) {
      globalForStore.__repoRescueDbWarned = true;
      console.warn("[reborescue] database unavailable; falling back to in-process storage for this server instance");
    }
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveScan(assessment: StoredAssessment): Promise<Storage> {
  const db = await database();
  if (db) {
    try {
      await db.insert(scans).values({
        id: assessment.scanId,
        repository: assessment.repository.fullName,
        repositoryUrl: assessment.repository.url,
        mode: assessment.mode,
        status: assessment.status,
        score: assessment.score.total,
        coverage: Math.round(assessment.score.coverage),
        findings: assessment.summary.totalFindings,
        assessment: { ...assessment, storage: "database" },
        createdAt: new Date(assessment.createdAt),
      });
      memoryScans().set(assessment.scanId, { assessment: { ...assessment, storage: "database" }, createdAt: assessment.createdAt });
      return "database";
    } catch (error) {
      console.warn("[reborescue] scan insert failed; using in-process storage", error instanceof Error ? error.message : "unknown");
    }
  }
  memoryScans().set(assessment.scanId, { assessment: { ...assessment, storage: "memory" }, createdAt: assessment.createdAt });
  return "memory";
}

export async function getStoredScan(scanId: string): Promise<{ assessment: StoredAssessment; storage: Storage } | null> {
  const memoryHit = memoryScans().get(scanId);
  if (memoryHit) return { assessment: memoryHit.assessment, storage: memoryHit.assessment.storage };

  if (!UUID_PATTERN.test(scanId)) return null;
  const db = await database();
  if (!db) return null;
  try {
    const rows = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { assessment: { ...row.assessment, storage: "database" }, storage: "database" };
  } catch {
    return null;
  }
}

export async function listStoredScans(limit = 12): Promise<ScanHistoryItem[]> {
  const fromMemory = Array.from(memoryScans().values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(({ assessment }) => toHistoryItem(assessment));

  const db = await database();
  if (!db) return fromMemory;
  try {
    const rows = await db.select().from(scans).orderBy(desc(scans.createdAt)).limit(limit);
    const fromDb = rows.map((row) => ({
      scanId: row.id,
      repository: row.repository,
      repositoryUrl: row.repositoryUrl,
      mode: row.mode as StoredAssessment["mode"],
      status: row.status as StoredAssessment["status"],
      score: row.score,
      coverage: row.coverage,
      findings: row.findings,
      createdAt: row.createdAt.toISOString(),
      storage: "database" as const,
    }));
    const merged = new Map<string, ScanHistoryItem>();
    for (const item of [...fromDb, ...fromMemory]) merged.set(item.scanId, item);
    return Array.from(merged.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  } catch {
    return fromMemory;
  }
}

function toHistoryItem(assessment: StoredAssessment): ScanHistoryItem {
  return {
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
  };
}

export async function saveVerification(record: VerificationRecord): Promise<Storage> {
  memoryVerifications().set(record.id, record);
  const db = await database();
  if (!db) return "memory";
  try {
    await db.insert(verifications).values({
      id: record.id,
      scanId: record.scanId,
      repository: record.repository,
      mode: record.mode,
      status: record.status,
      record,
      createdAt: new Date(record.createdAt),
    });
    return "database";
  } catch {
    return "memory";
  }
}

export async function getVerification(verificationId: string): Promise<VerificationRecord | null> {
  const memoryHit = memoryVerifications().get(verificationId);
  if (memoryHit) return memoryHit;
  if (!UUID_PATTERN.test(verificationId)) return null;
  const db = await database();
  if (!db) return null;
  try {
    const rows = await db.select().from(verifications).where(eq(verifications.id, verificationId)).limit(1);
    return rows[0]?.record ?? null;
  } catch {
    return null;
  }
}

export async function databaseReachable(): Promise<boolean> {
  const db = await database();
  if (!db) return false;
  try {
    await db.select().from(scans).limit(1);
    return true;
  } catch {
    return false;
  }
}

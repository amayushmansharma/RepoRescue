import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { StoredAssessment, VerificationRecord } from "@/lib/types";

/**
 * Persistence exists for two product reasons only:
 *  - a scan must survive across the FIND → FIX → REVIEW → VERIFY navigation,
 *  - verification evidence must be retrievable by id after it was produced.
 * Everything else is computed on demand from the stored assessment.
 */
export const scans = pgTable("scans", {
  id: uuid("id").primaryKey(),
  repository: text("repository").notNull(),
  repositoryUrl: text("repository_url").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  score: integer("score").notNull(),
  coverage: integer("coverage").notNull(),
  findings: integer("findings").notNull(),
  assessment: jsonb("assessment").$type<StoredAssessment>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey(),
  scanId: uuid("scan_id").notNull(),
  repository: text("repository").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  record: jsonb("record").$type<VerificationRecord>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScanRow = typeof scans.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;

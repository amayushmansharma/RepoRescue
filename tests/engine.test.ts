import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_FIXTURES, filesFromFixture } from "../src/server/demo/fixtures";
import { buildSnapshot } from "../src/server/analysis/snapshot";
import { evaluateRepository } from "../src/server/analysis/rules";
import { computeScore } from "../src/server/analysis/score";
import { runLocalVerification } from "../src/server/analysis/verify";
import type { RepositoryMeta, StoredAssessment } from "../src/lib/types";

const beacon = DEMO_FIXTURES[0];
const tidewatch = DEMO_FIXTURES[1];

function snapshotFor(fixture: typeof beacon) {
  return buildSnapshot({
    repository: fixture.repository,
    files: filesFromFixture(fixture),
    tree: [...fixture.files.map((file) => file.path), ...fixture.treeExtra],
    mode: "demo",
    fetchedAt: fixture.fetchedAt,
    analysisLimitations: [],
  });
}

const EMPTY_META: RepositoryMeta = {
  fullName: "test-org/empty-repo",
  owner: "test-org",
  name: "empty-repo",
  url: "https://github.com/test-org/empty-repo",
  defaultBranch: "main",
  description: null,
  topics: [],
  license: null,
  stars: 0,
  openIssues: 0,
  pushedAt: null,
  primaryLanguage: null,
  fixture: false,
};

test("beacon fixture produces an internally consistent, deterministic assessment", () => {
  const first = evaluateRepository(snapshotFor(beacon));
  const second = evaluateRepository(snapshotFor(beacon));
  assert.deepEqual(
    first.findings.map((finding) => finding.id),
    second.findings.map((finding) => finding.id),
    "rule evaluation must be deterministic",
  );
  assert.deepEqual(computeScore(first.checks), computeScore(second.checks));

  const ruleIds = first.findings.map((finding) => finding.ruleId).sort();
  for (const expected of [
    "ci-missing",
    "code-of-conduct-missing",
    "contributing-missing",
    "env-template-missing",
    "license-missing",
    "manifest-license-missing",
    "metadata-incomplete",
    "readme-prerequisites-missing",
    "templates-missing",
    "tests-missing",
  ]) {
    assert.ok(ruleIds.includes(expected), `expected finding ${expected}`);
  }
  // Documentation gaps must not be inflated into critical severity.
  assert.ok(first.findings.every((finding) => finding.severity !== "critical"));
  const envFinding = first.findings.find((finding) => finding.ruleId === "env-template-missing");
  assert.equal(envFinding?.confidence, "confirmed");
  assert.ok(envFinding?.evidence.some((evidence) => evidence.path === "src/config/env.ts"));
  // The README contains an install command, so that check must pass.
  assert.ok(!ruleIds.includes("readme-install-missing"));

  const score = computeScore(first.checks);
  assert.equal(score.total, 47, "beacon fixture readiness score is pinned");
  assert.equal(score.coverage, 85, "coverage must reflect not-applicable checks");
  assert.equal(score.dimensions.reduce((total, dimension) => total + dimension.weight, 0), 100);
  assert.ok(score.deductions.length > 0);
});

test("tidewatch fixture scores high and surfaces the README/template inconsistency", () => {
  const { findings, checks } = evaluateRepository(snapshotFor(tidewatch));
  const score = computeScore(checks);
  assert.ok(score.total >= 80, `expected a healthy score, received ${score.total}`);
  const ruleIds = findings.map((finding) => finding.ruleId);
  assert.ok(ruleIds.includes("env-template-missing"));
  assert.ok(ruleIds.includes("code-of-conduct-missing"));
  assert.ok(!ruleIds.includes("tests-missing"));
  assert.ok(!ruleIds.includes("ci-missing"));
  assert.ok(!ruleIds.includes("license-missing"));
});

test("an empty repository fails applicable checks without inventing evidence", () => {
  const snapshot = buildSnapshot({
    repository: EMPTY_META,
    files: [],
    tree: [],
    mode: "live",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    analysisLimitations: ["No files were readable."],
  });
  const { findings, checks } = evaluateRepository(snapshot);
  const score = computeScore(checks);
  assert.ok(findings.length > 0);
  assert.ok(findings.every((finding) => finding.evidence.length > 0), "every finding needs evidence");
  assert.ok(score.total <= 5, `empty repository should score near zero, received ${score.total}`);
  assert.ok(score.coverage < 100);
  assert.ok(checks.some((check) => check.status === "not-applicable"));
});

test("verification re-runs rules against the patched workspace and reports honest remote states", () => {
  const snapshot = snapshotFor(beacon);
  const { checks, findings } = evaluateRepository(snapshot);
  const score = computeScore(checks);
  const assessment: StoredAssessment = {
    scanId: "11111111-1111-4111-8111-111111111111",
    mode: "demo",
    status: "completed",
    repository: snapshot.repository,
    ecosystem: snapshot.ecosystem,
    createdAt: "2026-02-10T12:00:00.000Z",
    findings,
    score,
    summary: {
      totalFindings: findings.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      autoFixable: 0,
      manualOnly: 0,
      beginnerFriendly: 0,
    },
    limitations: [],
    nextSteps: [],
    snapshot,
    storage: "memory",
  };

  const autoIds = findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id);
  const record = runLocalVerification({ assessment, findingIds: autoIds, now: "2026-02-10T13:00:00.000Z" });

  assert.equal(record.scope, "local");
  assert.equal(record.status, "passed");
  assert.equal(record.remote.ci, "not-run");
  assert.equal(record.remote.pullRequest, "not-run");
  assert.ok(record.comparison);
  assert.equal(record.comparison?.beforeScore, 47);
  assert.equal(record.comparison?.afterScore, 84);
  assert.equal(record.comparison?.resolved.length, autoIds.length);
  assert.equal(record.comparison?.newlyDetected.length, 0);
  assert.ok(record.checks.some((check) => check.id === "code-execution" && check.state === "skipped"));
  assert.ok(record.checks.some((check) => check.id === "file-syntax" && check.state === "passed"));
  assert.ok(record.limitations.some((limitation) => limitation.includes("demo fixture")));

  // Deterministic: running again produces the same comparison.
  const repeat = runLocalVerification({ assessment, findingIds: autoIds, now: "2026-02-10T13:00:00.000Z" });
  assert.deepEqual(repeat.comparison, record.comparison);
});

test("verification with only manual findings is unavailable rather than falsely passed", () => {
  const snapshot = snapshotFor(beacon);
  const { checks, findings } = evaluateRepository(snapshot);
  const assessment: StoredAssessment = {
    scanId: "22222222-2222-4222-8222-222222222222",
    mode: "demo",
    status: "completed",
    repository: snapshot.repository,
    ecosystem: snapshot.ecosystem,
    createdAt: "2026-02-10T12:00:00.000Z",
    findings,
    score: computeScore(checks),
    summary: { totalFindings: findings.length, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, autoFixable: 0, manualOnly: 0, beginnerFriendly: 0 },
    limitations: [],
    nextSteps: [],
    snapshot,
    storage: "memory",
  };
  const record = runLocalVerification({ assessment, findingIds: ["tests-missing"], now: "2026-02-10T13:00:00.000Z" });
  assert.equal(record.status, "unavailable");
  assert.equal(record.comparison, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, unifiedDiff } from "../src/server/analysis/diff";
import { validateFileContent, validateJson, validateYaml, summariseValidation } from "../src/server/analysis/validators";
import { applyPlanToSnapshot, AUTOMATED_REMEDIATION_RULE_IDS, buildRemediationPlan } from "../src/server/analysis/remediations";
import { evaluateRepository } from "../src/server/analysis/rules";
import { buildSnapshot } from "../src/server/analysis/snapshot";
import { DEMO_FIXTURES, filesFromFixture } from "../src/server/demo/fixtures";

const beacon = DEMO_FIXTURES[0];

function beaconSnapshot() {
  return buildSnapshot({
    repository: beacon.repository,
    files: filesFromFixture(beacon),
    tree: [...beacon.files.map((file) => file.path), ...beacon.treeExtra],
    mode: "demo",
    fetchedAt: beacon.fetchedAt,
    analysisLimitations: [],
  });
}

test("diff generation handles new files and modifications with consistent counts", () => {
  const created = unifiedDiff(".env.example", null, "A=1\nB=2\n");
  assert.equal(created.additions, 3);
  assert.equal(created.deletions, 0);
  assert.match(created.diff, /^\+\+\+ b\/\.env\.example/m);

  const original = "# Title\n\nHello\n";
  const proposed = "# Title\n\nHello world\n\n## New section\n\nText\n";
  const modified = unifiedDiff("README.md", original, proposed);
  assert.ok(modified.additions >= 3);
  assert.match(modified.diff, /^--- a\/README.md/m);
  assert.match(modified.diff, /^@@ /m);

  // Applying the parsed diff's kept/added lines reproduces the proposal.
  const parsed = parseUnifiedDiff(modified.diff);
  assert.ok(parsed["README.md"].includes("Hello world"));
  assert.ok(parsed["README.md"].includes("## New section"));

  const unchanged = unifiedDiff("README.md", original, original);
  assert.equal(unchanged.diff, "");
});

test("validators report pass, fail and skipped honestly", () => {
  assert.equal(validateJson('{"a":1}').state, "passed");
  assert.equal(validateJson('{"a":}').state, "failed");
  assert.equal(validateYaml("name: ci\non:\n  push:\n").state, "passed");
  assert.equal(validateYaml("name: ci\n  bad: [\n").state, "failed");

  const markdown = validateFileContent("CONTRIBUTING.md", "# Contributing\n\n```bash\nnpm install\n```\n");
  assert.ok(markdown.every((check) => check.state === "passed"));

  const unbalanced = validateFileContent("docs/CONTRIBUTING.md", "# Title\n\n```bash\nnpm install\n");
  assert.equal(summariseValidation(unbalanced), "failed");

  const unknownType = validateFileContent("LICENSE", "MIT License\n");
  assert.equal(unknownType[0].state, "skipped");

  const envTemplate = validateFileContent(".env.example", "DATABASE_URL=postgres://x\nJWT_SECRET=change-me\n");
  assert.equal(summariseValidation(envTemplate), "passed");
  assert.equal(validateFileContent(".env.example", "broken-line\n").some((check) => check.state === "failed"), true);
});

test("remediation plan creates validated patches for auto-fixable findings only", () => {
  const snapshot = beaconSnapshot();
  const { findings } = evaluateRepository(snapshot);
  const autoIds = findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id);
  const manualIds = findings.filter((finding) => finding.remediation.kind === "manual").map((finding) => finding.id);
  assert.ok(autoIds.length > 0);
  assert.ok(manualIds.length > 0);

  const plan = buildRemediationPlan(snapshot, findings, [...autoIds, ...manualIds], "2026-02-10T13:00:00.000Z");
  const patches = plan.proposals.filter((proposal) => proposal.kind === "patch");
  const manual = plan.proposals.filter((proposal) => proposal.kind === "manual");
  assert.equal(patches.length, autoIds.length);
  assert.equal(manual.length, manualIds.length);
  assert.ok(manual.every((proposal) => proposal.files.length === 0 && proposal.instructions.length > 0));
  assert.ok(patches.every((proposal) => proposal.overallValidation !== "failed"));
  assert.ok(patches.every((proposal) => proposal.limitations.some((limitation) => limitation.includes("No change was applied"))));

  const envProposal = patches.find((proposal) => proposal.findingId === "env-template-missing");
  assert.ok(envProposal);
  const envFile = envProposal?.files.find((file) => file.path === ".env.example");
  assert.ok(envFile?.proposed.includes("DATABASE_URL="));
  assert.ok(envFile?.proposed.includes("JWT_SECRET="));
  assert.ok(envFile?.proposed.includes("PORT="));
  assert.equal(envFile?.changeType, "create");

  const ciProposal = patches.find((proposal) => proposal.findingId === "ci-missing");
  assert.ok(ciProposal);
  const workflow = ciProposal?.files.find((file) => file.path === ".github/workflows/ci.yml");
  assert.ok(workflow?.proposed.includes("npm ci"));
  assert.equal(validateYaml(workflow?.proposed ?? "").state, "passed");

  // Two findings may touch package.json: engines and license.
  const readmePatch = patches.find((proposal) => proposal.findingId === "readme-prerequisites-missing");
  assert.ok(readmePatch?.files.some((file) => file.path === "README.md" && file.changeType === "modify"));
  assert.ok(readmePatch?.files.some((file) => file.path === "package.json" && file.proposed.includes('"engines"')));

  const patched = applyPlanToSnapshot(snapshot, plan);
  assert.ok(patched.tree.includes(".env.example"));
  assert.ok(patched.tree.includes(".github/workflows/ci.yml"));
  assert.ok(patched.files.find((file) => file.path === "package.json")?.content.includes(">=20"));
  assert.ok(patched.analysisLimitations.some((limitation) => limitation.includes("in-memory workspace")));

  // Manual findings must not produce patches even when selected.
  assert.ok(!patches.some((proposal) => proposal.findingId === "license-missing"));
});

test("remediation is deterministic for the same selection", () => {
  const snapshot = beaconSnapshot();
  const { findings } = evaluateRepository(snapshot);
  const ids = findings.map((finding) => finding.id);
  const first = buildRemediationPlan(snapshot, findings, ids, "2026-02-10T13:00:00.000Z");
  const second = buildRemediationPlan(snapshot, findings, ids, "2026-02-10T13:00:00.000Z");
  assert.deepEqual(
    first.proposals.map((proposal) => [proposal.id, proposal.files.map((file) => file.path)]),
    second.proposals.map((proposal) => [proposal.id, proposal.files.map((file) => file.path)]),
  );
  assert.deepEqual(
    first.proposals.flatMap((proposal) => proposal.files.map((file) => file.diff)),
    second.proposals.flatMap((proposal) => proposal.files.map((file) => file.diff)),
  );
});

test("automated remediation catalogue matches the findings marked auto-fixable", () => {
  const { findings } = evaluateRepository(beaconSnapshot());
  for (const finding of findings.filter((entry) => entry.remediation.kind === "auto")) {
    assert.ok(AUTOMATED_REMEDIATION_RULE_IDS.includes(finding.ruleId), `${finding.ruleId} is marked auto but has no builder`);
  }
});

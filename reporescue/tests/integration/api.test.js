import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.REPORESCUE_PERSIST = "false";

const { createApp } = await import("../../server/src/app.js");

let server;
let base;

before(async () => {
  const app = createApp({ serveClient: false });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const postJson = (path, body) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (path) => (await fetch(`${base}${path}`)).json();

let cachedBeaconScan = null;

async function createBeaconScan() {
  if (cachedBeaconScan) return cachedBeaconScan;
  const response = await postJson("/api/scans", { mode: "demo", demoId: "beacon-api" });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  cachedBeaconScan = { scanId: payload.data.scan.scanId, payload };
  return cachedBeaconScan;
}

test("health and capabilities report storage, credential mode and the write policy", async () => {
  const health = await getJson("/api/health");
  assert.equal(health.ok, true);
  assert.equal(health.checks.remoteWrites, "disabled");
  assert.match(health.checks.storage, /^memory/);

  const capabilities = await getJson("/api/config/capabilities");
  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.data.capabilities.githubDelivery.available, false);
  assert.equal(capabilities.data.capabilities.aiAssistance.available, false);
  assert.equal(capabilities.data.ruleCatalogue.checks.length, 21);
  assert.equal(Object.values(capabilities.data.scoring.weights).reduce((a, b) => a + b, 0), 100);
});

test("security headers are present and nothing leaks the server identity", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("demo repositories endpoint lists deterministic fixtures", async () => {
  const payload = await getJson("/api/demo-repositories");
  assert.equal(payload.data.repositories.length, 2);
  assert.ok(payload.data.repositories.every((repository) => repository.fixtureNote.includes("fixture")));
});

test("demo scan returns a full, client-safe assessment", async () => {
  const { payload } = await createBeaconScan();
  const scan = payload.data.scan;
  assert.equal(scan.mode, "demo");
  assert.equal(scan.score.total, 47);
  assert.ok(scan.findings.length > 5);
  assert.equal(scan.snapshot.files, undefined, "repository file bodies must not be sent to the browser");
  assert.ok(scan.limitations.some((limitation) => limitation.includes("DEMO SCAN")));
  assert.equal(payload.data.meta.accessMode, "fixture");
});

test("invalid input is rejected with structured errors", async () => {
  assert.equal((await postJson("/api/scans", { demoId: "does-not-exist" })).status, 400);
  const badRepo = await postJson("/api/scans", { repository: "https://gitlab.com/owner/repo" });
  assert.equal(badRepo.status, 400);
  assert.equal((await badRepo.json()).error.code, "INVALID_REPOSITORY");
  assert.equal((await postJson("/api/scans", {})).status, 400);

  const noContentType = await fetch(`${base}/api/scans`, { method: "POST", body: "{}" });
  assert.equal(noContentType.status, 400);

  const malformed = await fetch(`${base}/api/scans`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_INPUT");

  const huge = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repository: "x".repeat(70_000) }),
  });
  assert.equal(huge.status, 413);
});

test("unknown scan ids and unknown routes return 404 JSON", async () => {
  const response = await fetch(`${base}/api/scans/99999999-9999-4999-8999-999999999999`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
  const unknownRoute = await fetch(`${base}/api/nope`);
  assert.equal(unknownRoute.status, 404);
});

test("findings filtering, score, report and history use the stored assessment", async () => {
  const { scanId } = await createBeaconScan();
  const high = await getJson(`/api/scans/${scanId}/findings?severity=high&sort=rule`);
  assert.ok(high.data.returned > 0);
  assert.ok(high.data.findings.every((finding) => finding.severity === "high"));
  const search = await getJson(`/api/scans/${scanId}/findings?q=environment`);
  assert.ok(search.data.findings.some((finding) => finding.ruleId === "env-template-missing"));
  const score = await getJson(`/api/scans/${scanId}/score`);
  assert.equal(score.data.total, 47);
  assert.equal(score.data.dimensions.length, 5);
  const report = await getJson(`/api/scans/${scanId}/report`);
  assert.equal(report.data.scan.scanId, scanId);
  const history = await getJson("/api/scans");
  assert.ok(history.data.scans.some((scan) => scan.scanId === scanId));
});

test("full FIX → REVIEW → export → VERIFY workflow through the REST API", async () => {
  const { scanId, payload } = await createBeaconScan();
  const autoIds = payload.data.scan.findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id);
  assert.ok(autoIds.length >= 5);

  const preview = await (await postJson("/api/remediations/preview", { scanId, findingIds: autoIds })).json();
  assert.equal(preview.ok, true);
  assert.equal(preview.data.totals.patchProposals, autoIds.length);
  assert.ok(preview.data.boundaryNote.includes("PREVIEW ONLY"));
  assert.ok(preview.data.proposals.every((proposal) => proposal.files.every((file) => file.diff.length > 0)));

  const validation = await (await postJson("/api/remediations/validate", { scanId, findingIds: autoIds })).json();
  assert.equal(validation.data.summary.failed, 0);
  assert.ok(validation.data.filesConsidered.includes(".env.example"));

  const exportResponse = await postJson(`/api/scans/${scanId}/export`, { findingIds: autoIds });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") ?? "", /application\/zip/);
  assert.match(exportResponse.headers.get("content-disposition") ?? "", /attachment; filename="reborescue-/);
  const bytes = new Uint8Array(await exportResponse.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  const archiveText = new TextDecoder().decode(bytes);
  for (const entry of ["manifest.json", "proposed.patch", "REVIEW.md", "files/.env.example"]) assert.ok(archiveText.includes(entry), entry);
  assert.ok(!archiveText.includes("GITHUB_TOKEN="), "exports must never contain server configuration");

  const pr = await (await postJson("/api/pull-requests/preview", { scanId, findingIds: autoIds })).json();
  assert.equal(pr.data.performedRemoteWrites, false);
  assert.match(pr.data.draft.branch, /^reborescue\//);
  assert.ok(pr.data.draft.checklist.some((item) => item.label.includes("pull request") && item.done === false));

  const delivery = await postJson("/api/pull-requests", { scanId, findingIds: autoIds, confirm: true });
  assert.equal(delivery.status, 401);
  assert.equal((await delivery.json()).error.code, "AUTHENTICATION_REQUIRED");

  const verificationResponse = await postJson("/api/verifications", { scanId, findingIds: autoIds });
  assert.equal(verificationResponse.status, 201);
  const verification = (await verificationResponse.json()).data.verification;
  assert.equal(verification.status, "passed");
  assert.equal(verification.remote.ci, "not-run");
  assert.equal(verification.comparison.beforeScore, 47);
  assert.equal(verification.comparison.afterScore, 84);
  const fetched = await getJson(`/api/verifications/${verification.id}`);
  assert.equal(fetched.data.verification.id, verification.id);

  const withEvidence = await (await postJson("/api/pull-requests/preview", { scanId, findingIds: autoIds, verificationId: verification.id })).json();
  assert.ok(withEvidence.data.draft.description.includes("Recorded verification"));
});

test("selection endpoints reject unknown findings, empty selections and foreign verification ids", async () => {
  const { scanId } = await createBeaconScan();
  assert.equal((await postJson("/api/remediations/preview", { scanId, findingIds: ["not-a-finding"] })).status, 400);
  assert.equal((await postJson("/api/remediations/preview", { scanId, findingIds: [] })).status, 400);
  const foreign = await postJson("/api/pull-requests/preview", {
    scanId,
    findingIds: ["env-template-missing"],
    verificationId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(foreign.status, 404);
  const manualOnly = await postJson(`/api/scans/${scanId}/export`, { findingIds: ["license-missing"] });
  assert.equal(manualOnly.status, 422);
});

test("scan progress reports real server phases and honest 404s", async () => {
  const progressId = "55555555-5555-4555-8555-555555555555";
  const response = await postJson("/api/scans", { mode: "demo", demoId: "beacon-api", progressId });
  assert.equal(response.status, 201);

  const progress = await getJson(`/api/scans/progress/${progressId}`);
  assert.equal(progress.ok, true);
  assert.equal(progress.data.status, "complete");
  const keys = progress.data.phases.map((phase) => phase.key);
  assert.deepEqual(keys, ["normalising-input", "normalising-content", "running-rules", "calculating-score", "saving-assessment", "complete"]);
  assert.ok(progress.data.phases.every((phase) => phase.label.length > 0));
  assert.equal(progress.data.phases.at(-1).key, "complete");

  const unknown = await fetch(`${base}/api/scans/progress/66666666-6666-4666-8666-666666666666`);
  assert.equal(unknown.status, 404);
  const malformed = await fetch(`${base}/api/scans/progress/not-a-uuid`);
  assert.equal(malformed.status, 404);
});

test("a failing scan records a failed phase instead of a silent success", async () => {
  const progressId = "77777777-7777-4777-8777-777777777777";
  const response = await postJson("/api/scans", { mode: "live", repository: "https://gitlab.com/owner/repo", progressId });
  assert.equal(response.status, 400);
  const progress = await getJson(`/api/scans/progress/${progressId}`);
  assert.equal(progress.data.status, "failed");
  assert.equal(progress.data.phases.at(-1).key, "failed");
});

test("an invalid progressId is ignored and the scan still succeeds", async () => {
  const response = await postJson("/api/scans", { mode: "demo", demoId: "beacon-api", progressId: "not-a-uuid" });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.scan.score.total, 47);
});

test("explain finding endpoint provides structured explanation with fallback", async () => {
  const { scanId } = await createBeaconScan();

  const explainRes = await fetch(`${base}/api/scans/${scanId}/findings/env-template-missing/explain`);
  assert.equal(explainRes.status, 200);
  const payload = await explainRes.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.scanId, scanId);
  assert.equal(payload.data.findingId, "env-template-missing");
  assert.ok(payload.data.explanation.text.length > 50);
  assert.ok(payload.data.explanation.text.includes("**What was found**"));
  assert.equal(payload.data.explanation.source, "deterministic");

  const unknownFinding = await fetch(`${base}/api/scans/${scanId}/findings/non-existent-rule/explain`);
  assert.equal(unknownFinding.status, 404);

  const unknownScan = await fetch(`${base}/api/scans/00000000-0000-0000-0000-000000000000/findings/env-template-missing/explain`);
  assert.equal(unknownScan.status, 404);
});

test("opportunities endpoint returns prioritized contribution opportunities", async () => {
  const { scanId } = await createBeaconScan();

  const res = await fetch(`${base}/api/scans/${scanId}/opportunities`);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.scanId, scanId);
  assert.ok(payload.data.opportunities.length > 0);

  const first = payload.data.opportunities[0];
  assert.ok(first.id.startsWith("opp-"));
  assert.ok(first.title.length > 0);
  assert.equal(first.source, "scanner-finding");
  assert.ok(["high", "medium", "low"].includes(first.priority));
  assert.ok(["easy", "medium", "involved"].includes(first.difficulty));

  // Test filter queries
  const beginnerOnly = await (await fetch(`${base}/api/scans/${scanId}/opportunities?beginnerOnly=true`)).json();
  assert.ok(beginnerOnly.data.opportunities.every((o) => o.beginnerSuitable));

  const fixableOnly = await (await fetch(`${base}/api/scans/${scanId}/opportunities?fixableOnly=true`)).json();
  assert.ok(fixableOnly.data.opportunities.every((o) => o.fixable));
});

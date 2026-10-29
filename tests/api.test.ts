import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as healthGET } from "../src/app/api/health/route";
import { GET as demosGET } from "../src/app/api/demo-repositories/route";
import { GET as scansGET, POST as scansPOST } from "../src/app/api/scans/route";
import { GET as scanGET } from "../src/app/api/scans/[scanId]/route";
import { GET as findingsGET } from "../src/app/api/scans/[scanId]/findings/route";
import { GET as scoreGET } from "../src/app/api/scans/[scanId]/score/route";
import { POST as exportPOST } from "../src/app/api/scans/[scanId]/export/route";
import { POST as previewPOST } from "../src/app/api/remediations/preview/route";
import { POST as validatePOST } from "../src/app/api/remediations/validate/route";
import { POST as prPOST } from "../src/app/api/pull-requests/preview/route";
import { POST as verificationPOST } from "../src/app/api/verifications/route";
import { GET as progressGET } from "../src/app/api/scans/progress/[progressId]/route";
import { GET as verificationGET } from "../src/app/api/verifications/[verificationId]/route";

type Json = Record<string, any>;

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function createBeaconScan(): Promise<{ scanId: string; payload: Json }> {
  const response = await scansPOST(jsonRequest("/api/scans", { mode: "demo", demoId: "beacon-api" }));
  assert.equal(response.status, 201);
  const payload = await read(response);
  assert.equal(payload.ok, true);
  return { scanId: payload.data.scan.scanId, payload };
}

test("health endpoint reports service state and the write policy", async () => {
  const response = await healthGET();
  assert.equal(response.status, 200);
  const payload = await read(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.checks.remoteWrites, "disabled");
  assert.equal(payload.checks.llm, "not used: findings come from deterministic rules");
});

test("demo repositories endpoint lists deterministic fixtures", async () => {
  const response = await demosGET();
  const payload = await read(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.repositories.length, 2);
  assert.ok(payload.data.repositories.every((repository: Json) => repository.fixtureNote.includes("fixture")));
});

test("demo scan returns a full, client-safe assessment", async () => {
  const { payload } = await createBeaconScan();
  const scan = payload.data.scan;
  assert.equal(scan.mode, "demo");
  assert.equal(scan.status, "completed");
  assert.equal(scan.score.total, 47);
  assert.equal(scan.findings.length > 5, true);
  assert.equal(scan.snapshot.files, undefined, "repository file bodies must not be sent to the browser");
  assert.equal(typeof scan.snapshot.fileCount, "number");
  assert.ok(scan.limitations.some((limitation: string) => limitation.includes("DEMO SCAN")));
  assert.ok(payload.data.meta.durationMs >= 0);
});

test("invalid demo id and malformed live repository are rejected with structured errors", async () => {
  const badDemo = await scansPOST(jsonRequest("/api/scans", { demoId: "does-not-exist" }));
  assert.equal(badDemo.status, 400);
  const badDemoBody = await read(badDemo);
  assert.equal(badDemoBody.ok, false);
  assert.equal(badDemoBody.error.code, "INVALID_INPUT");

  const badRepo = await scansPOST(jsonRequest("/api/scans", { repository: "https://gitlab.com/owner/repo" }));
  assert.equal(badRepo.status, 400);
  const badRepoBody = await read(badRepo);
  assert.equal(badRepoBody.error.code, "INVALID_REPOSITORY");

  const empty = await scansPOST(jsonRequest("/api/scans", {}));
  assert.equal(empty.status, 400);

  const badContentType = await scansPOST(new Request("http://localhost/api/scans", { method: "POST", body: "{}" }));
  assert.equal(badContentType.status, 400);
});

test("unknown scan ids return 404 without leaking internals", async () => {
  const response = await scanGET(new Request("http://localhost/api/scans/x"), { params: Promise.resolve({ scanId: "99999999-9999-4999-8999-999999999999" }) });
  assert.equal(response.status, 404);
  const payload = await read(response);
  assert.equal(payload.error.code, "NOT_FOUND");
});

test("findings, score and history endpoints expose the stored assessment", async () => {
  const { scanId } = await createBeaconScan();

  const findingsResponse = await findingsGET(new Request(`http://localhost/api/scans/${scanId}/findings?severity=high&sort=rule`), {
    params: Promise.resolve({ scanId }),
  });
  assert.equal(findingsResponse.status, 200);
  const findingsPayload = await read(findingsResponse);
  assert.ok(findingsPayload.data.returned > 0);
  assert.ok(findingsPayload.data.findings.every((finding: Json) => finding.severity === "high"));

  const searchResponse = await findingsGET(new Request(`http://localhost/api/scans/${scanId}/findings?q=environment`), {
    params: Promise.resolve({ scanId }),
  });
  const searchPayload = await read(searchResponse);
  assert.ok(searchPayload.data.findings.some((finding: Json) => finding.ruleId === "env-template-missing"));

  const scoreResponse = await scoreGET(new Request("http://localhost"), { params: Promise.resolve({ scanId }) });
  const scorePayload = await read(scoreResponse);
  assert.equal(scorePayload.data.total, 47);
  assert.equal(scorePayload.data.dimensions.length, 5);

  const historyResponse = await scansGET();
  const historyPayload = await read(historyResponse);
  assert.ok(historyPayload.data.scans.some((scan: Json) => scan.scanId === scanId));
});

test("full remediation → review → verification workflow works through the REST API", async () => {
  const { scanId, payload } = await createBeaconScan();
  const autoIds: string[] = payload.data.scan.findings
    .filter((finding: Json) => finding.remediation.kind === "auto")
    .map((finding: Json) => finding.id);
  assert.ok(autoIds.length >= 5);

  const previewResponse = await previewPOST(jsonRequest("/api/remediations/preview", { scanId, findingIds: autoIds }));
  assert.equal(previewResponse.status, 200);
  const preview = await read(previewResponse);
  assert.equal(preview.data.boundaryNote.includes("PREVIEW ONLY"), true);
  assert.equal(preview.data.totals.patchProposals, autoIds.length);
  assert.ok(preview.data.proposals.every((proposal: Json) => proposal.files.every((file: Json) => file.diff.length > 0)));
  assert.ok(preview.data.totals.additions > 0);

  const exportResponse = await exportPOST(jsonRequest(`/api/scans/${scanId}/export`, { findingIds: autoIds }), {
    params: Promise.resolve({ scanId }),
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") ?? "", /application\/zip/);
  assert.match(exportResponse.headers.get("content-disposition") ?? "", /attachment; filename="reborescue-/);
  const archiveBytes = new Uint8Array(await exportResponse.arrayBuffer());
  assert.deepEqual(Array.from(archiveBytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04], "must be a real ZIP file");
  const archiveText = new TextDecoder().decode(archiveBytes);
  assert.ok(archiveText.includes("manifest.json"));
  assert.ok(archiveText.includes("proposed.patch"));
  assert.ok(archiveText.includes("files/.env.example"));
  assert.ok(!archiveText.includes(process.env.DATABASE_URL ?? "database-sentinel"), "exports must never contain server config");

  const validateResponse = await validatePOST(jsonRequest("/api/remediations/validate", { scanId, findingIds: autoIds }));
  const validation = await read(validateResponse);
  assert.equal(validation.data.summary.failed, 0);
  assert.ok(validation.data.filesConsidered.includes(".env.example"));

  const prResponse = await prPOST(jsonRequest("/api/pull-requests/preview", { scanId, findingIds: autoIds }));
  const pr = await read(prResponse);
  assert.equal(pr.data.performedRemoteWrites, false);
  assert.match(pr.data.draft.branch, /^reborescue\//);
  assert.ok(pr.data.draft.description.includes("## Problem"));
  assert.ok(pr.data.draft.checklist.some((item: Json) => item.label.includes("pull request") && item.done === false));
  assert.equal(pr.data.draft.files.length > 0, true);

  const verificationResponse = await verificationPOST(jsonRequest("/api/verifications", { scanId, findingIds: autoIds }));
  assert.equal(verificationResponse.status, 201);
  const verification = await read(verificationResponse);
  assert.equal(verification.data.verification.status, "passed");
  assert.equal(verification.data.verification.remote.ci, "not-run");
  assert.equal(verification.data.verification.comparison.beforeScore, 47);
  assert.equal(verification.data.verification.comparison.afterScore, 84);

  const verificationId = verification.data.verification.id;
  const fetchResponse = await verificationGET(new Request(`http://localhost/api/verifications/${verificationId}`), {
    params: Promise.resolve({ verificationId }),
  });
  assert.equal(fetchResponse.status, 200);
  const fetched = await read(fetchResponse);
  assert.equal(fetched.data.verification.id, verificationId);
});

test("selection endpoints reject unknown findings and mismatched verification ids", async () => {
  const { scanId } = await createBeaconScan();
  const response = await previewPOST(jsonRequest("/api/remediations/preview", { scanId, findingIds: ["not-a-finding"] }));
  assert.equal(response.status, 400);
  const payload = await read(response);
  assert.equal(payload.error.code, "INVALID_INPUT");

  const noIds = await previewPOST(jsonRequest("/api/remediations/preview", { scanId, findingIds: [] }));
  assert.equal(noIds.status, 400);

  const badVerification = await prPOST(
    jsonRequest("/api/pull-requests/preview", { scanId, findingIds: ["env-template-missing"], verificationId: "11111111-1111-4111-8111-111111111111" }),
  );
  assert.equal(badVerification.status, 404);

  const missingScan = await verificationPOST(jsonRequest("/api/verifications", { scanId: "99999999-9999-4999-8999-999999999999", findingIds: ["env-template-missing"] }));
  assert.equal(missingScan.status, 404);
});

test("scan progress reports real server phases and honest 404s", async () => {
  const progressId = "55555555-5555-4555-8555-555555555555";
  const created = await scansPOST(jsonRequest("/api/scans", { mode: "demo", demoId: "beacon-api", progressId }));
  assert.equal(created.status, 201);

  const response = await progressGET(new Request(`http://localhost/api/scans/progress/${progressId}`), {
    params: Promise.resolve({ progressId }),
  });
  const payload = await read(response);
  assert.equal(response.status, 200);
  assert.equal(payload.data.status, "complete");
  assert.deepEqual(
    payload.data.phases.map((phase: Json) => phase.key),
    ["normalising-input", "normalising-content", "running-rules", "calculating-score", "saving-assessment", "complete"],
  );
  assert.ok(payload.data.phases.every((phase: Json) => typeof phase.label === "string" && phase.label.length > 0));

  const unknown = await progressGET(new Request("http://localhost/api/scans/progress/x"), {
    params: Promise.resolve({ progressId: "66666666-6666-4666-8666-666666666666" }),
  });
  assert.equal(unknown.status, 404);
  const malformed = await progressGET(new Request("http://localhost/api/scans/progress/x"), {
    params: Promise.resolve({ progressId: "not-a-uuid" }),
  });
  assert.equal(malformed.status, 404);
});

test("a failing scan records a failed phase instead of a silent success", async () => {
  const progressId = "77777777-7777-4777-8777-777777777777";
  const failed = await scansPOST(jsonRequest("/api/scans", { mode: "live", repository: "https://gitlab.com/owner/repo", progressId }));
  assert.equal(failed.status, 400);
  const response = await progressGET(new Request(`http://localhost/api/scans/progress/${progressId}`), {
    params: Promise.resolve({ progressId }),
  });
  const payload = await read(response);
  assert.equal(payload.data.status, "failed");
  assert.equal(payload.data.phases.at(-1).key, "failed");
});

test("an invalid progressId is ignored and the scan still succeeds", async () => {
  const response = await scansPOST(jsonRequest("/api/scans", { mode: "demo", demoId: "beacon-api", progressId: "not-a-uuid" }));
  assert.equal(response.status, 201);
  const payload = await read(response);
  assert.equal(payload.data.scan.score.total, 47);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginProgress,
  finishProgress,
  isValidProgressId,
  markProgress,
  readProgress,
  resetProgressStore,
} from "../src/server/services/scan-progress";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

test.beforeEach(() => resetProgressStore());

test("accepts only well-formed progress ids", () => {
  assert.equal(isValidProgressId(ID), true);
  assert.equal(isValidProgressId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidProgressId("not-a-uuid"), false);
  assert.equal(isValidProgressId(""), false);
  assert.equal(isValidProgressId(undefined), false);
  assert.equal(isValidProgressId(ID.toUpperCase()), true);
});

test("records the phases a scan actually performs, in order", () => {
  beginProgress(ID);
  markProgress(ID, "normalising-input");
  markProgress(ID, "running-rules");
  markProgress(ID, "calculating-score");
  const snapshot = readProgress(ID);
  assert.ok(snapshot);
  assert.equal(snapshot?.status, "running");
  assert.deepEqual(
    snapshot?.phases.map((phase) => phase.key),
    ["normalising-input", "running-rules", "calculating-score"],
  );
  // Every phase carries a human label so the UI never invents wording.
  assert.ok(snapshot?.phases.every((phase) => phase.label.length > 0 && phase.at.length > 0));
  assert.ok((snapshot?.elapsedMs ?? -1) >= 0);
});

test("duplicate consecutive phases are collapsed, distinct repeats are kept", () => {
  beginProgress(ID);
  markProgress(ID, "running-rules");
  markProgress(ID, "running-rules");
  markProgress(ID, "calculating-score");
  markProgress(ID, "running-rules");
  assert.deepEqual(
    readProgress(ID)?.phases.map((phase) => phase.key),
    ["running-rules", "calculating-score", "running-rules"],
  );
});

test("phases are ignored after the record finishes, and termination is explicit", () => {
  beginProgress(ID);
  markProgress(ID, "normalising-input");
  finishProgress(ID, "complete");
  markProgress(ID, "running-rules");
  const snapshot = readProgress(ID);
  assert.equal(snapshot?.status, "complete");
  assert.deepEqual(
    snapshot?.phases.map((phase) => phase.key),
    ["normalising-input", "complete"],
  );

  beginProgress(OTHER);
  finishProgress(OTHER, "failed");
  const failed = readProgress(OTHER);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.phases.at(-1)?.key, "failed");
});

test("unknown ids and invalid ids read as null", () => {
  assert.equal(readProgress("33333333-3333-4333-8333-333333333333"), null);
  assert.equal(readProgress("garbage"), null);
  assert.equal(readProgress(undefined), null);
});

test("marking an unknown id is a no-op rather than an error", () => {
  assert.doesNotThrow(() => markProgress("44444444-4444-4444-8444-444444444444", "running-rules"));
  assert.equal(readProgress("44444444-4444-4444-8444-444444444444"), null);
});

test("a live scan records the GitHub retrieval phases in order", () => {
  beginProgress(ID);
  markProgress(ID, "normalising-input");
  markProgress(ID, "fetching-metadata");
  markProgress(ID, "discovering-files");
  markProgress(ID, "running-rules");
  markProgress(ID, "calculating-score");
  markProgress(ID, "saving-assessment");
  finishProgress(ID, "complete");
  const keys = readProgress(ID)?.phases.map((phase) => phase.key) ?? [];
  assert.deepEqual(keys, [
    "normalising-input",
    "fetching-metadata",
    "discovering-files",
    "running-rules",
    "calculating-score",
    "saving-assessment",
    "complete",
  ]);
});

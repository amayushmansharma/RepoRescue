import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceResources } from "../../client/src/state/workspace-resources.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("workspace resources share pending requests and reuse the actual result", async () => {
  const store = createWorkspaceResources();
  let calls = 0;
  const pending = deferred();
  const loader = () => { calls += 1; return pending.promise; };
  const first = store.load("scan-a:env-template", loader);
  const duplicate = store.load("scan-a:env-template", loader);
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);
  const response = { proposals: [{ findingId: "env-template" }] };
  pending.resolve(response);
  assert.equal(await first, response);
  assert.equal(await store.load("scan-a:env-template", loader), response);
  assert.equal(calls, 1);
});

test("a failed response stays an error until retried, then clears the old error", async () => {
  const store = createWorkspaceResources();
  const failure = new Error("upstream unavailable");
  await assert.rejects(store.load("preview", () => Promise.reject(failure)), failure);
  assert.equal(store.peek("preview").error, failure);
  assert.equal(store.peek("preview").data, null);
  store.invalidate("preview");
  const response = { validated: true };
  await store.load("preview", () => response);
  assert.equal(store.peek("preview").data, response);
  assert.equal(store.peek("preview").error, null);
});

test("late responses cannot overwrite a replacement or cross scan/selection keys", async () => {
  const store = createWorkspaceResources();
  const late = deferred();
  const old = store.load("scan-a:selection-a", () => late.promise);
  store.invalidate("scan-a:selection-a");
  await store.load("scan-a:selection-a", () => "new response");
  await store.load("scan-b:selection-a", () => "different scan");
  late.resolve("stale response");
  await old;
  assert.equal(store.peek("scan-a:selection-a").data, "new response");
  assert.equal(store.peek("scan-b:selection-a").data, "different scan");
  assert.equal(store.peek("scan-a:selection-b").status, "idle");
});

test("resource subscriptions stop after unmount and settled entries are bounded", async () => {
  const store = createWorkspaceResources(2);
  let notifications = 0;
  const off = store.subscribe("first", () => { notifications += 1; });
  await store.load("first", () => 1);
  assert.equal(notifications, 2); // pending + fulfilled
  off();
  store.prime("first", 2);
  assert.equal(notifications, 2);
  await store.load("second", () => 2);
  await store.load("third", () => 3);
  assert.equal(store.peek("first").status, "idle");
  assert.equal(store.peek("second").data, 2);
  assert.equal(store.peek("third").data, 3);
});

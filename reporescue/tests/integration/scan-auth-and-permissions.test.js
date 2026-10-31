import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../../server/src/app.js";
import { _createTestSession } from "../../server/src/auth/auth-service.js";
import { githubRateLimitError } from "../../server/src/github/client.js";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let server;
let base;
let testScanId;

before(async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "test";

  const app = createApp({ clientOrigin: "http://localhost:5173" });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  // Create a demo scan to test endpoints with
  const res = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "demo", demoId: "beacon-api" }),
  });
  const data = await res.json();
  testScanId = data.data.scan.scanId;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("Session metadata exposes scopes and hasWriteScope without leaking accessToken", async () => {
  const session = _createTestSession({
    login: "alice-dev",
    name: "Alice Developer",
    accessToken: "gho_super_secret_token_12345",
    scope: "read:user,public_repo",
  });

  const res = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: session.cookieHeader },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.authenticated, true);
  assert.equal(body.data.user.login, "alice-dev");
  assert.deepEqual(body.data.scopes, ["read:user", "public_repo"]);
  assert.equal(body.data.hasWriteScope, true);
  assert.equal(body.data.requiresReauth, false);

  // Critical security check: token must NEVER leak in session payload
  const stringified = JSON.stringify(body);
  assert.equal(stringified.includes("gho_super_secret_token_12345"), false);
  assert.equal("accessToken" in body.data, false);
});

test("Session with only read:user detects missing write scope and requiresReauth", async () => {
  const readOnlySession = _createTestSession({
    login: "bob-readonly",
    name: "Bob Readonly",
    accessToken: "gho_readonly_token_67890",
    scope: "read:user",
  });

  const res = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: readOnlySession.cookieHeader },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.authenticated, true);
  assert.equal(body.data.hasWriteScope, false);
  assert.equal(body.data.requiresReauth, true);

  // Submitting a PR with only read:user must be rejected with INSUFFICIENT_PERMISSION (403)
  const prRes = await fetch(`${base}/api/pull-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: readOnlySession.cookieHeader,
    },
    body: JSON.stringify({
      scanId: testScanId,
      findingIds: ["license-present"],
    }),
  });

  assert.equal(prRes.status, 403);
  const prBody = await prRes.json();
  assert.equal(prBody.ok, false);
  assert.equal(prBody.error.code, "INSUFFICIENT_PERMISSION");
  assert.match(prBody.error.message, /public_repo/);
  assert.equal(JSON.stringify(prBody).includes("gho_readonly_token_67890"), false);
});

test("GET /api/config/capabilities and /api/health dynamically reflect authenticated session", async () => {
  const session = _createTestSession({
    login: "charlie-writes",
    accessToken: "gho_write_token_11111",
    scope: "read:user,public_repo",
  });

  // Guest capabilities
  const guestRes = await fetch(`${base}/api/config/capabilities`);
  const guestCap = await guestRes.json();
  assert.equal(guestCap.data.capabilities.liveScan.accessMode, "anonymous");
  assert.equal(guestCap.data.capabilities.liveScan.rateLimitTier, "60/hr (anonymous)");

  // Authenticated capabilities
  const authRes = await fetch(`${base}/api/config/capabilities`, {
    headers: { Cookie: session.cookieHeader },
  });
  const authCap = await authRes.json();
  assert.equal(authCap.data.capabilities.liveScan.accessMode, "authenticated");
  assert.equal(authCap.data.capabilities.liveScan.rateLimitTier, "5000/hr (authenticated)");
  assert.equal(authCap.data.capabilities.liveScan.authenticatedUser, "charlie-writes");

  // Authenticated health check
  const authHealthRes = await fetch(`${base}/api/health`, {
    headers: { Cookie: session.cookieHeader },
  });
  const authHealth = await authHealthRes.json();
  assert.match(authHealth.checks.githubToken, /authenticated user session/);
});

test("Rate limit error formatting distinguishes anonymous (60/hr) vs authenticated (5000/hr)", () => {
  // Anonymous rate limit
  const anonErr = githubRateLimitError(null, 1730000000);
  assert.equal(anonErr.code, "GITHUB_RATE_LIMITED");
  assert.match(anonErr.message, /60 requests\/hour/);
  assert.match(anonErr.message, /Sign in with GitHub/);

  // Authenticated rate limit
  const authErr = githubRateLimitError("gho_some_token", 1730000000);
  assert.equal(authErr.code, "GITHUB_RATE_LIMITED");
  assert.match(authErr.message, /5,000 requests\/hour/);
  assert.match(authErr.message, /for this session/);
});

test("Scan assessment isolation: token never stored in assessment record", async () => {
  const session = _createTestSession({
    login: "diana-test",
    accessToken: "gho_secret_diana_token",
    scope: "read:user,public_repo",
  });

  // Fetch the scan assessment via the authenticated session
  const res = await fetch(`${base}/api/scans/${testScanId}`, {
    headers: { Cookie: session.cookieHeader },
  });
  const data = await res.json();
  assert.equal(res.status, 200);

  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes("gho_secret_diana_token"), false);
});

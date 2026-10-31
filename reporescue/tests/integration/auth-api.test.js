import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { _createTestSession } from "../../server/src/auth/auth-service.js";

process.env.REPORESCUE_PERSIST = "false";
const TEST_SECRET = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

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

const getJson = async (path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, payload: await res.json() };
};

test("auth config reports unconfigured when credentials are absent", async () => {
  const { status, payload } = await getJson("/api/auth/config");
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.configured, false);
  assert.equal(payload.data.provider, "github");
  assert.equal(payload.data.scopes, "read:user public_repo");
});

test("guest session is unauthenticated by default", async () => {
  const { status, payload } = await getJson("/api/auth/session");
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.authenticated, false);
  assert.equal(payload.data.user, null);
});

test("login endpoint returns 503 when OAuth is unconfigured", async () => {
  const res = await fetch(`${base}/api/auth/github/login`, { redirect: "manual" });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "NOT_CONFIGURED");
});

test("callback with access_denied redirects cleanly to login error", async () => {
  const res = await fetch(`${base}/api/auth/github/callback?error=access_denied`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location.includes("/login?auth=access_denied"));
});

test("callback with invalid state redirects with error", async () => {
  const res = await fetch(`${base}/api/auth/github/callback?code=somecode&state=invalidsignature`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location.includes("auth=invalid_state") || location.includes("auth=state_mismatch"));
});

test("authenticated session flow: login retrieval, profile, and logout", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const testUser = {
    login: "rescuecontributor",
    name: "Rescue Contributor",
    avatarUrl: "https://avatars.githubusercontent.com/u/12345?v=4",
  };

  const { cookieHeader } = _createTestSession(testUser);

  // 1. Session request with valid cookie returns authenticated user
  const sessionRes = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.equal(sessionData.ok, true);
  assert.equal(sessionData.data.authenticated, true);
  assert.equal(sessionData.data.user.login, "rescuecontributor");
  assert.equal(sessionData.data.user.name, "Rescue Contributor");
  assert.equal(sessionData.data.user.avatarUrl, "https://avatars.githubusercontent.com/u/12345?v=4");

  // 2. Logout invalidates session and sets cookie expiry
  const logoutRes = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
  });
  assert.equal(logoutRes.status, 200);
  const logoutData = await logoutRes.json();
  assert.equal(logoutData.ok, true);
  assert.equal(logoutData.data.loggedOut, true);
  const setCookie = logoutRes.headers.get("set-cookie");
  assert.ok(setCookie.includes("Max-Age=0"));

  // 3. Subsequent session check returns unauthenticated
  const sessionAfter = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: cookieHeader },
  });
  const sessionAfterData = await sessionAfter.json();
  assert.equal(sessionAfterData.data.authenticated, false);
  assert.equal(sessionAfterData.data.user, null);
});

test("guest mode: demo scanning and verification operate without authentication", async () => {
  // Guest can initiate a scan completely unauthenticated
  const scanRes = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "demo", demoId: "beacon-api" }),
  });
  assert.equal(scanRes.status, 201);
  const scanData = await scanRes.json();
  assert.equal(scanData.ok, true);
  assert.equal(scanData.data.scan.score.total, 47);
});

test("dev-login respects remember flag: persistent cookie vs session cookie", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  // 1. Remember: true (persistent)
  const resPersistent = await fetch(`${base}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "persisteddev", remember: true }),
  });
  assert.equal(resPersistent.status, 200);
  const setCookiePersistent = resPersistent.headers.get("set-cookie");
  assert.ok(setCookiePersistent.includes("Max-Age=2592000"));
  assert.ok(setCookiePersistent.includes("HttpOnly"));
  assert.ok(setCookiePersistent.includes("SameSite=Lax"));

  // Check /session with persistent cookie
  const cookieMatchPersistent = /reporescue_session=[^;]+/.exec(setCookiePersistent)[0];
  const sessionResP = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: cookieMatchPersistent },
  });
  const sessionDataP = await sessionResP.json();
  assert.equal(sessionDataP.ok, true);
  assert.equal(sessionDataP.data.authenticated, true);
  assert.equal(sessionDataP.data.user.login, "persisteddev");
  assert.equal(sessionDataP.data.remember, true);

  // 2. Remember: false (non-persistent session cookie)
  const resSession = await fetch(`${base}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "sessiondev", remember: false }),
  });
  assert.equal(resSession.status, 200);
  const setCookieSession = resSession.headers.get("set-cookie");
  assert.ok(!setCookieSession.includes("Max-Age"));
  assert.ok(setCookieSession.includes("HttpOnly"));
  assert.ok(setCookieSession.includes("SameSite=Lax"));

  // Check /session with session cookie
  const cookieMatchSession = /reporescue_session=[^;]+/.exec(setCookieSession)[0];
  const sessionResS = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: cookieMatchSession },
  });
  const sessionDataS = await sessionResS.json();
  assert.equal(sessionDataS.ok, true);
  assert.equal(sessionDataS.data.authenticated, true);
  assert.equal(sessionDataS.data.user.login, "sessiondev");
  assert.equal(sessionDataS.data.remember, false);
});

test("stale or invalid session cookie is gracefully cleared on GET /api/auth/session", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const res = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: "reporescue_session=invalid-cookie-token" },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.data.authenticated, false);
  assert.equal(data.data.user, null);

  // Stale cookie is cleared with Max-Age=0
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.ok(setCookie.includes("Max-Age=0"));
});

test("revoked or invalid GitHub token in PR flow triggers session cleanup and cookie eviction", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const badSession = _createTestSession({
    login: "revokeduser",
    accessToken: "bad_revoked_token",
    scope: "read:user,public_repo",
    remember: true,
  });

  // Create demo scan to have a valid scanId
  const scanRes = await fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "demo", demoId: "beacon-api" }),
  });
  const scanData = await scanRes.json();
  const scanId = scanData.data.scan.scanId;

  // Step 1: Preview to get a cryptographically valid confirmToken
  const previewRes = await fetch(`${base}/api/pull-requests/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: badSession.cookieHeader,
    },
    body: JSON.stringify({
      scanId,
      findingIds: ["readme-prerequisites-missing"],
    }),
  });
  const previewData = await previewRes.json();
  const sub = previewData.data.submission;

  // Step 2: Intercept global fetch to simulate GitHub API rejecting the token (HTTP 401 Bad credentials)
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("api.github.com")) {
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "Bad credentials" }),
      };
    }
    return originalFetch(url, init);
  };

  try {
    const prRes = await fetch(`${base}/api/pull-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: badSession.cookieHeader,
      },
      body: JSON.stringify({
        scanId,
        findingIds: ["readme-prerequisites-missing"],
        confirmToken: sub.confirmToken,
        preparedAt: sub.preparedAt,
        contentHash: sub.contentHash,
        baseSha: sub.baseSha,
        baseBranch: sub.baseBranch,
        title: "docs: fix prerequisites",
        body: "Automated PR",
      }),
    });

    assert.equal(prRes.status, 401);
    const prData = await prRes.json();
    assert.equal(prData.ok, false);
    assert.equal(prData.error.code, "SESSION_REQUIRES_REAUTH");

    // Verify Set-Cookie header evicts the revoked session
    const setCookie = prRes.headers.get("set-cookie");
    assert.ok(setCookie, "Response must include Set-Cookie header");
    assert.ok(setCookie.includes("Max-Age=0"), "Cookie must be evicted with Max-Age=0");

    // Subsequent check on /session confirms user was unauthenticated
    const sessionCheck = await fetch(`${base}/api/auth/session`, {
      headers: { Cookie: badSession.cookieHeader },
    });
    const checkData = await sessionCheck.json();
    assert.equal(checkData.data.authenticated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

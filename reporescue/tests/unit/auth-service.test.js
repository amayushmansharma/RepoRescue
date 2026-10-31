import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeUrl,
  clearSession,
  githubCallback,
  sessionForRequest,
  _createTestSession,
  PERSISTENT_SESSION_TTL_MS,
  TRANSIENT_SESSION_TTL_MS,
  PERSISTENT_COOKIE_MAX_AGE_SECONDS,
  __resetAuthForTests,
} from "../../server/src/auth/auth-service.js";
import {
  createOpaqueSessionId,
  verifyOpaqueSessionCookie,
  sessionSecretBytes,
  cookieAttributes,
} from "../../server/src/auth/session-store.js";
import { githubAppReady } from "../../server/src/github/github-app-config.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeEach(() => {
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.GITHUB_APP_CLIENT_ID;
  delete process.env.GITHUB_APP_CLIENT_SECRET;
  delete process.env.REPORESCUE_SESSION_SECRET;
});

test("githubAppReady reports false when configuration is missing", () => {
  assert.equal(githubAppReady(), false);
  assert.throws(() => authorizeUrl({}), {
    code: "NOT_CONFIGURED",
  });
});

test("authorizeUrl generates cryptographically signed state with read:user public_repo scopes", () => {
  process.env.GITHUB_CLIENT_ID = "test-client-id-1234";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret-5678";
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  assert.equal(githubAppReady(), true);

  const { url, state } = authorizeUrl({});
  assert.ok(url.startsWith("https://github.com/login/oauth/authorize"));

  const parsedUrl = new URL(url);
  assert.equal(parsedUrl.searchParams.get("client_id"), "test-client-id-1234");
  assert.equal(parsedUrl.searchParams.get("scope"), "read:user public_repo");
  assert.ok(!parsedUrl.searchParams.get("scope").split(" ").includes("repo")); // Strictly public_repo only, never broad repo access!
  assert.equal(parsedUrl.searchParams.get("allow_signup"), "false");
  assert.equal(parsedUrl.searchParams.get("state"), state);

  // State format: raw.expiresAt.signature
  const parts = state.split(".");
  assert.equal(parts.length, 3);
  const [raw, expiresAt, signature] = parts;
  assert.ok(raw.length === 32); // 16 bytes hex
  assert.ok(Number(expiresAt) > Date.now());
  assert.ok(signature.length === 64); // SHA256 hex
});

test("tampered or reused state is rejected", async () => {
  process.env.GITHUB_CLIENT_ID = "test-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const { state } = authorizeUrl({});
  const parts = state.split(".");

  // Tampered signature
  const fakeState = `${parts[0]}.${parts[1]}.${"0".repeat(64)}`;
  const res1 = await githubCallback({ code: "valid-code", stateCode: fakeState, req: null });
  assert.equal(res1.statusCode, 302);
  assert.ok(res1.url.includes("auth=state_mismatch") || res1.url.includes("invalid_state"));

  // Tampered expiry
  const tamperedExpiry = `${parts[0]}.${Date.now() + 9999999}.${parts[2]}`;
  const res2 = await githubCallback({ code: "valid-code", stateCode: tamperedExpiry, req: null });
  assert.equal(res2.statusCode, 302);
  assert.ok(res2.url.includes("auth=state_mismatch") || res2.url.includes("invalid_state"));
});

test("createOpaqueSessionId creates signed opaque identifiers", () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const session = createOpaqueSessionId();
  assert.ok(session.raw);
  assert.ok(session.publicId);
  assert.ok(session.cookieValue);
  assert.ok(session.cookieValue.includes("."));

  const secretBuffer = Buffer.from(TEST_SECRET, "hex");
  const isValid = verifyOpaqueSessionCookie(session.cookieValue, session.raw, secretBuffer);
  assert.equal(isValid, true);

  // Altered cookie fails verification
  const tampered = session.cookieValue.slice(0, -4) + "ffff";
  assert.equal(verifyOpaqueSessionCookie(tampered, session.raw, secretBuffer), false);
});

test("session creation, retrieval, and removal lifecycle", async () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const user = { login: "testcontributor", name: "Test Contributor", avatarUrl: "https://example.com/avatar.png" };
  const { cookieHeader } = _createTestSession(user);

  const mockReq = { headers: { cookie: cookieHeader } };
  const session = sessionForRequest(mockReq);
  assert.ok(session);
  assert.equal(session.userId, "testcontributor");
  assert.equal(session.name, "Test Contributor");
  assert.equal(session.avatarUrl, "https://example.com/avatar.png");
  assert.ok(!session.accessToken); // Access tokens are not exposed on user session!

  // Logout removes session
  const clearCookieHeader = await clearSession(mockReq);
  assert.ok(clearCookieHeader.includes("Max-Age=0"));

  // Subsequent request yields null
  const sessionAfterLogout = sessionForRequest(mockReq);
  assert.equal(sessionAfterLogout, null);
});

test("expired session is rejected", () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const { cookieHeader } = _createTestSession({ login: "expiringuser" });
  const mockReq = { headers: { cookie: cookieHeader } };

  const session = sessionForRequest(mockReq);
  assert.ok(session);

  // Fast forward expiry
  session.expiresAt = Date.now() - 1000;

  const expiredSession = sessionForRequest(mockReq);
  assert.equal(expiredSession, null);
});

test("production fails safely when session secret is missing", () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.REPORESCUE_SESSION_SECRET;

  try {
    assert.equal(sessionSecretBytes(), null);
    assert.equal(githubAppReady(), false);
  } finally {
    process.env.NODE_ENV = previousEnv;
  }
});

test("cookie attributes strictly include HttpOnly and SameSite=Lax", () => {
  const prodCookie = cookieAttributes({ secure: true });
  assert.ok(prodCookie.includes("HttpOnly"));
  assert.ok(prodCookie.includes("SameSite=Lax"));
  assert.ok(prodCookie.includes("Secure"));
  assert.ok(prodCookie.includes("Path=/"));
});

test("user profile payload isolates identity and never includes access tokens", () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const { cookieHeader } = _createTestSession({ login: "safedeveloper", name: "Safe Dev", avatarUrl: "https://avatar.url" });
  const session = sessionForRequest({ headers: { cookie: cookieHeader } });

  assert.ok(session);
  assert.equal(session.userId, "safedeveloper");
  assert.equal(session.accessToken, undefined);
  assert.equal(session.clientSecret, undefined);
  assert.equal(JSON.stringify(session).includes("ghu_"), false);
});

test("cookieAttributes differentiates persistent cookies vs non-persistent session cookies", () => {
  // Non-persistent (default): no Max-Age, browser discards on session close
  const sessionCookie = cookieAttributes({ persistent: false });
  assert.ok(sessionCookie.includes("HttpOnly"));
  assert.ok(sessionCookie.includes("SameSite=Lax"));
  assert.ok(!sessionCookie.includes("Max-Age"));

  // Persistent: explicit Max-Age for 30-day persistence
  const persistentCookie = cookieAttributes({ persistent: true });
  assert.ok(persistentCookie.includes("HttpOnly"));
  assert.ok(persistentCookie.includes("SameSite=Lax"));
  assert.ok(persistentCookie.includes(`Max-Age=${PERSISTENT_COOKIE_MAX_AGE_SECONDS}`));
});

test("authorizeUrl securely carries remember flag in CSRF state", () => {
  process.env.GITHUB_CLIENT_ID = "test-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const unchecked = authorizeUrl({}, { remember: false });
  assert.equal(unchecked.remember, false);

  const checked = authorizeUrl({}, { remember: true });
  assert.equal(checked.remember, true);
});

test("persistent session creates 30-day TTL vs non-persistent 24-hour TTL", () => {
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;

  const now = Date.now();

  // 1. Non-persistent session (remember: false)
  const transientSession = _createTestSession({ login: "transientuser", remember: false });
  const req1 = { headers: { cookie: transientSession.cookieHeader } };
  const s1 = sessionForRequest(req1);
  assert.ok(s1);
  assert.equal(s1.remember, false);
  const diff1 = s1.expiresAt - now;
  assert.ok(diff1 >= TRANSIENT_SESSION_TTL_MS - 2000 && diff1 <= TRANSIENT_SESSION_TTL_MS + 2000);

  // 2. Persistent session (remember: true)
  const persistentSession = _createTestSession({ login: "persistentuser", remember: true });
  const req2 = { headers: { cookie: persistentSession.cookieHeader } };
  const s2 = sessionForRequest(req2);
  assert.ok(s2);
  assert.equal(s2.remember, true);
  const diff2 = s2.expiresAt - now;
  assert.ok(diff2 >= PERSISTENT_SESSION_TTL_MS - 2000 && diff2 <= PERSISTENT_SESSION_TTL_MS + 2000);
});

test("session restoration across restart from persistent disk mirror", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporescue-auth-test-"));
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  process.env.REPORESCUE_DATA_DIR = tmpDir;
  process.env.REPORESCUE_PERSIST = "true";

  try {
    __resetAuthForTests();

    // Create a persistent session and a transient session
    const persistent = _createTestSession({ login: "savedaccount", remember: true });
    const transient = _createTestSession({ login: "tempaccount", remember: false });

    // Give file write a moment to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify sessions.json exists on disk
    const rawDisk = await fs.readFile(path.join(tmpDir, "sessions.json"), "utf8");
    const parsed = JSON.parse(rawDisk);
    assert.equal(Array.isArray(parsed), true);
    // Only persistent session should be saved to disk
    assert.equal(parsed.some((s) => s.userId === "savedaccount"), true);
    assert.equal(parsed.some((s) => s.userId === "tempaccount"), false);

    // Simulate complete server restart by clearing in-memory Map
    __resetAuthForTests();

    // Verify persistent session is restored from disk
    const restored = sessionForRequest({ headers: { cookie: persistent.cookieHeader } });
    assert.ok(restored);
    assert.equal(restored.userId, "savedaccount");
    assert.equal(restored.remember, true);

    // Verify transient session was NOT restored
    const notRestored = sessionForRequest({ headers: { cookie: transient.cookieHeader } });
    assert.equal(notRestored, null);
  } finally {
    __resetAuthForTests();
    delete process.env.REPORESCUE_DATA_DIR;
    delete process.env.REPORESCUE_PERSIST;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("persisted access tokens are encrypted with AES-256-GCM and files have restrictive 0600 permissions", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporescue-auth-perm-"));
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  process.env.REPORESCUE_DATA_DIR = tmpDir;
  process.env.REPORESCUE_PERSIST = "true";

  try {
    __resetAuthForTests();

    const rawSecretToken = "ghu_top_secret_oauth_token_8888";
    const session = _createTestSession({
      login: "encrypteduser",
      accessToken: rawSecretToken,
      remember: true,
    });

    await new Promise((r) => setTimeout(r, 60));

    const filePath = path.join(tmpDir, "sessions.json");
    const rawDisk = await fs.readFile(filePath, "utf8");

    // 1. Plaintext token is NEVER written to disk
    assert.equal(rawDisk.includes(rawSecretToken), false, "Raw access token must never appear in plaintext on disk");
    assert.ok(rawDisk.includes("enc:v1:"), "Serialized record must contain enc:v1: ciphertext");

    // 2. File and directory permissions must be strictly owner-only (0600 file, 0700 dir)
    const fileStat = await fs.stat(filePath);
    assert.equal(fileStat.mode & 0o777, 0o600, "sessions.json must have 0600 permissions");

    const dirStat = await fs.stat(tmpDir);
    assert.equal(dirStat.mode & 0o777, 0o700, "sessions directory must have 0700 permissions");

    // 3. Decrypts accurately when restoring into memory
    __resetAuthForTests();
    const restored = sessionForRequest({ headers: { cookie: session.cookieHeader } });
    assert.ok(restored);
    assert.equal(restored.accessToken, rawSecretToken, "Token must be decrypted accurately into memory");
  } finally {
    __resetAuthForTests();
    delete process.env.REPORESCUE_DATA_DIR;
    delete process.env.REPORESCUE_PERSIST;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("legacy plaintext sessions are safely migrated to encrypted ciphertext on startup", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporescue-auth-mig-"));
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  process.env.REPORESCUE_DATA_DIR = tmpDir;
  process.env.REPORESCUE_PERSIST = "true";

  try {
    __resetAuthForTests();

    // Prepare a legacy unencrypted sessions.json file
    const sessionRecord = createOpaqueSessionId();
    const legacyPlaintext = [
      {
        sessionId: sessionRecord.raw,
        publicId: sessionRecord.publicId,
        userId: "legacyuser",
        name: "Legacy User",
        avatarUrl: null,
        accessToken: "gho_legacy_unencrypted_token_value",
        scope: "read:user,public_repo",
        expiresAt: Date.now() + 1000000,
        remember: true,
        createdAt: Date.now(),
      },
    ];

    const filePath = path.join(tmpDir, "sessions.json");
    await fs.writeFile(filePath, JSON.stringify(legacyPlaintext), "utf8");

    // Booting / loading sessions triggers transparent migration
    const restored = sessionForRequest({ headers: { cookie: `reporescue_session=${sessionRecord.cookieValue}` } });
    assert.ok(restored);
    assert.equal(restored.accessToken, "gho_legacy_unencrypted_token_value");

    await new Promise((r) => setTimeout(r, 60));

    // Disk file must now be migrated to encrypted format with 0600 permissions
    const migratedRaw = await fs.readFile(filePath, "utf8");
    assert.equal(migratedRaw.includes("gho_legacy_unencrypted_token_value"), false);
    assert.ok(migratedRaw.includes("enc:v1:"));

    const stat = await fs.stat(filePath);
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    __resetAuthForTests();
    delete process.env.REPORESCUE_DATA_DIR;
    delete process.env.REPORESCUE_PERSIST;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("clearSession awaits persistent deletion and cleans disk file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporescue-auth-clear-"));
  process.env.REPORESCUE_SESSION_SECRET = TEST_SECRET;
  process.env.REPORESCUE_DATA_DIR = tmpDir;
  process.env.REPORESCUE_PERSIST = "true";

  try {
    __resetAuthForTests();

    const session = _createTestSession({ login: "user_to_logout", remember: true });
    await new Promise((r) => setTimeout(r, 60));

    const filePath = path.join(tmpDir, "sessions.json");
    const beforeRaw = await fs.readFile(filePath, "utf8");
    assert.ok(beforeRaw.includes("user_to_logout"));

    // Logout
    const cookieHeader = await clearSession({ headers: { cookie: session.cookieHeader } });
    assert.ok(cookieHeader.includes("Max-Age=0"));

    // Disk file must be empty
    const afterRaw = await fs.readFile(filePath, "utf8");
    assert.equal(afterRaw.includes("user_to_logout"), false);
  } finally {
    __resetAuthForTests();
    delete process.env.REPORESCUE_DATA_DIR;
    delete process.env.REPORESCUE_PERSIST;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

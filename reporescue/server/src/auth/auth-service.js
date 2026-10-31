import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "../http/errors.js";
import {
  clientOrigin,
  githubAppReady,
  githubCallbackUrl,
  githubClientId,
  githubClientSecret,
} from "../github/github-app-config.js";
import {
  exchangeAuthorizationCode,
  fetchGithubUserProfile,
  githubLoginUrl,
} from "../github/oauth-exchange.js";
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  clearSessionCookie,
  cookieAttributes,
  createOpaqueSessionId,
  sessionCookieName,
  sessionSecretBytes,
  verifyOpaqueSessionCookie,
} from "./session-store.js";
import {
  encryptAccessToken,
  decryptAccessToken,
} from "./token-encryption.js";

function getTransientSessionTtlMs() {
  const custom = Number(process.env.REPORESCUE_TRANSIENT_SESSION_TTL_MS);
  if (Number.isFinite(custom) && custom > 0) return custom;
  return 4 * 60 * 60 * 1000; // 4 hours default for non-persistent sessions
}

export const PERSISTENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const TRANSIENT_SESSION_TTL_MS = getTransientSessionTtlMs();
export const PERSISTENT_COOKIE_MAX_AGE_SECONDS = DEFAULT_SESSION_MAX_AGE_SECONDS;
const LOGIN_TTL_MS = 10 * 60 * 1000;
const loginStates = new Map();
const sessions = new Map();

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(here, "../../data");

function persistenceEnabled() {
  return process.env.REPORESCUE_PERSIST !== "false";
}

function dataDir() {
  return process.env.REPORESCUE_DATA_DIR ? path.resolve(process.env.REPORESCUE_DATA_DIR) : defaultDataDir;
}

let sessionsLoaded = false;

function ensureSessionsLoaded() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  if (!persistenceEnabled()) return;
  try {
    const file = path.join(dataDir(), "sessions.json");
    if (!fsSync.existsSync(file)) return;
    try {
      fsSync.chmodSync(file, 0o600);
    } catch {
      // Continue even if chmod fails in non-POSIX environments
    }
    const raw = fsSync.readFileSync(file, "utf8");
    const records = JSON.parse(raw);
    let needsMigration = false;
    if (Array.isArray(records)) {
      const now = Date.now();
      for (const record of records) {
        if (record && record.sessionId && record.expiresAt > now) {
          if (record.accessToken) {
            const dec = decryptAccessToken(record.accessToken, { sessionId: record.sessionId });
            if (dec.token) {
              record.accessToken = dec.token;
              if (dec.isLegacy) {
                needsMigration = true; // Legacy plaintext token migrated to encrypted
              }
            } else {
              // Token decryption failed or was tampered; safely require reauth
              record.accessToken = null;
              record.requiresReauth = true;
              needsMigration = true;
            }
          }
          sessions.set(record.sessionId, record);
        }
      }
    }
    if (needsMigration) {
      persistSessions().catch(() => {});
    }
  } catch {
    // Disk read failures continue with in-memory store
  }
}

async function persistSessions() {
  if (!persistenceEnabled()) return;
  try {
    const dir = dataDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700).catch(() => {});
    const now = Date.now();
    const active = Array.from(sessions.values()).filter(
      (s) => s.remember && s.expiresAt > now
    );
    const toSave = active.map((s) => {
      const copy = { ...s };
      if (copy.accessToken) {
        copy.accessToken = encryptAccessToken(copy.accessToken, { sessionId: copy.sessionId });
      }
      return copy;
    });
    const tmp = path.join(dir, "sessions.json.tmp");
    const dest = path.join(dir, "sessions.json");
    await fs.writeFile(tmp, JSON.stringify(toSave), { encoding: "utf8", mode: 0o600 });
    await fs.chmod(tmp, 0o600).catch(() => {});
    await fs.rename(tmp, dest);
    await fs.chmod(dest, 0o600).catch(() => {});
  } catch {
    // Continue in-process if JSON mirror is temporarily unavailable
  }
}

function secretBytes() {
  const bytes = sessionSecretBytes();
  if (!bytes) {
    throw new ApiError(
      "NOT_CONFIGURED",
      "A 64-hex-character RepoRescue session secret (REPORESCUE_SESSION_SECRET) is required before GitHub can be connected.",
    );
  }
  return bytes;
}

function pruneStates() {
  const now = Date.now();
  for (const [key, value] of loginStates) {
    if (value.expiresAt <= now) loginStates.delete(key);
  }
}

function stateSignature(raw, expiresAt, redirectUriValue) {
  return crypto
    .createHmac("sha256", secretBytes())
    .update(`${raw}:${expiresAt}:${redirectUriValue}`, "utf8")
    .digest("hex");
}

export function authorizeUrl(req, options = {}) {
  if (!githubAppReady()) {
    throw new ApiError(
      "NOT_CONFIGURED",
      "GitHub OAuth authentication is not configured on this server.",
    );
  }
  const redirectUriValue = githubCallbackUrl(req);
  const raw = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + LOGIN_TTL_MS;
  const signature = stateSignature(raw, expiresAt, redirectUriValue);
  const state = `${raw}.${expiresAt}.${signature}`;
  const remember = Boolean(options.remember);
  loginStates.set(raw, { expiresAt, redirectUri: redirectUriValue, used: false, remember });
  pruneStates();

  const url = githubLoginUrl({
    clientId: githubClientId(),
    redirectUri: redirectUriValue,
    state,
    scopes: options.scopes ?? "read:user public_repo",
  });
  return { url, state, remember };
}

function useState(state, req) {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 3) return { ok: false, url: loginUrlWithError("invalid_state", req) };
  const [raw, expiresAt, signature] = parts;
  const expiry = Number(expiresAt);
  const record = loginStates.get(raw);
  if (!record || record.used) return { ok: false, url: loginUrlWithError("state_reused", req) };
  const expected = stateSignature(raw, expiry, record.redirectUri);
  const sigBuf = Buffer.from(String(signature), "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, url: loginUrlWithError("state_mismatch", req) };
  }
  if (Date.now() > record.expiresAt) return { ok: false, url: loginUrlWithError("expired", req) };
  loginStates.delete(raw);
  record.used = true;
  return { ok: true, record };
}

function loginUrlWithError(reason, req) {
  const origin = clientOrigin(req);
  const url = new URL("/login", origin);
  url.searchParams.set("auth", reason);
  return url.toString();
}

export async function githubCallback({ code, stateCode, req }) {
  const value = String(code ?? "").trim();
  if (!value || value.length > 200) {
    return { setCookie: clearSessionCookie(), statusCode: 302, url: loginUrlWithError("invalid_code", req) };
  }
  const stateValue = String(stateCode ?? "").trim();
  if (!stateValue || stateValue.length > 300) {
    return { setCookie: clearSessionCookie(), statusCode: 302, url: loginUrlWithError("invalid_state", req) };
  }
  const verified = useState(stateValue, req);
  if (!verified.ok) {
    return { setCookie: clearSessionCookie(), statusCode: 302, url: verified.url };
  }

  let tokenSet;
  try {
    tokenSet = await exchangeAuthorizationCode({
      clientId: githubClientId(),
      clientSecret: githubClientSecret(),
      code: value,
      redirectUri: verified.record.redirectUri,
    });
  } catch (error) {
    const reason = error instanceof ApiError && error.code === "USER_CANCELLED" ? "cancelled" : "token_exchange_failed";
    return { setCookie: clearSessionCookie(), statusCode: 302, url: loginUrlWithError(reason, req) };
  }

  if (!tokenSet?.accessToken) {
    return { setCookie: clearSessionCookie(), statusCode: 302, url: loginUrlWithError("authorization_failed", req) };
  }

  let userProfile;
  try {
    userProfile = await fetchGithubUserProfile(tokenSet.accessToken);
  } catch {
    return { setCookie: clearSessionCookie(), statusCode: 302, url: loginUrlWithError("profile_fetch_failed", req) };
  }

  const remember = Boolean(verified.record.remember);
  const sessionTtl = remember ? PERSISTENT_SESSION_TTL_MS : TRANSIENT_SESSION_TTL_MS;

  const sessionRecord = createOpaqueSessionId();
  const record = {
    sessionId: sessionRecord.raw,
    publicId: sessionRecord.publicId,
    userId: userProfile.login,
    name: userProfile.name,
    avatarUrl: userProfile.avatarUrl,
    accessToken: tokenSet.accessToken,
    scope: tokenSet.scope ?? "",
    expiresAt: Date.now() + sessionTtl,
    remember,
    createdAt: Date.now(),
  };
  sessions.set(sessionRecord.raw, record);
  if (remember) {
    persistSessions().catch(() => {});
  }

  const origin = clientOrigin(req);
  const successUrl = new URL("/login", origin);
  successUrl.searchParams.set("auth", "connected");

  return {
    setCookie: `${sessionCookieName()}=${sessionRecord.cookieValue}; ${cookieAttributes({ persistent: remember, maxAge: PERSISTENT_COOKIE_MAX_AGE_SECONDS })}`,
    statusCode: 302,
    url: successUrl.toString(),
  };
}

export function sessionForRequest(req) {
  const header = req?.headers?.cookie;
  if (!header) return null;
  const name = sessionCookieName();
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(header));
  if (!match) return null;
  const cookieVal = match[1];
  const publicId = cookieVal.split(".")[0];
  
  ensureSessionsLoaded();

  // Find matching session in memory
  for (const [raw, session] of sessions) {
    if (session.publicId === publicId) {
      if (Date.now() >= session.expiresAt) {
        sessions.delete(raw);
        persistSessions().catch(() => {});
        return null;
      }
      try {
        if (!verifyOpaqueSessionCookie(cookieVal, raw, secretBytes())) {
          return null;
        }
        return session;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function clearSession(req) {
  const session = sessionForRequest(req);
  if (session) {
    sessions.delete(session.sessionId);
    try {
      await persistSessions();
    } catch {
      // Disk failure must not block cookie eviction
    }
  }
  return clearSessionCookie();
}

/** Invalidate session and evict cookie when authentication fails remotely */
export async function invalidateSessionForRequest(req) {
  return clearSession(req);
}

/** Testing helper to manually create a session */
export function _createTestSession({ login, name, avatarUrl, accessToken, scope = "read:user,public_repo", remember = false }) {
  ensureSessionsLoaded();
  const sessionRecord = createOpaqueSessionId();
  const sessionTtl = remember ? PERSISTENT_SESSION_TTL_MS : TRANSIENT_SESSION_TTL_MS;
  const record = {
    sessionId: sessionRecord.raw,
    publicId: sessionRecord.publicId,
    userId: login,
    name: name ?? login,
    avatarUrl: avatarUrl ?? null,
    expiresAt: Date.now() + sessionTtl,
    remember,
    createdAt: Date.now(),
  };
  if (accessToken) record.accessToken = accessToken;
  if (scope) record.scope = scope;
  sessions.set(sessionRecord.raw, record);
  if (remember) {
    persistSessions().catch(() => {});
  }
  return {
    cookieValue: sessionRecord.cookieValue,
    cookieHeader: `${sessionCookieName()}=${sessionRecord.cookieValue}`,
    sessionId: sessionRecord.raw,
    remember,
  };
}

/** Reset helper for testing environments */
export function __resetAuthForTests() {
  sessions.clear();
  loginStates.clear();
  sessionsLoaded = false;
}

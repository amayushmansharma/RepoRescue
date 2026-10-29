import crypto from "node:crypto";

const SESSION_COOKIE = "reporescue_session";
const SESSION_TTL_MS = 60 * 60 * 1000;
const LOGIN_TTL_MS = 10 * 60 * 1000;

const loginStates = new Map();
const sessions = new Map();

function hexSecretFromEnv() {
  const raw = process.env.REPORESCUE_SESSION_SECRET?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value), "utf8").digest("hex");
}

function hexSecret() {
  return hexSecretFromEnv();
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function randomOpaqueId() {
  return crypto.randomBytes(32).toString("base64url");
}

function signatureForRaw(raw, secret) {
  return hmacSha256Hex(secret, `session:${String(raw)}`);
}

function publicIdFromRaw(raw) {
  return Buffer.from(String(raw), "hex").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createOpaqueSessionId() {
  const raw = crypto.randomBytes(32).toString("hex");
  const publicId = publicIdFromRaw(raw);
  const secret = hexSecretFromEnv();
  return {
    raw,
    publicId,
    cookieValue: secret ? `${publicId}.${signatureForRaw(raw, secret)}` : publicId,
  };
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function cookieAttributes({ secure = process.env.NODE_ENV === "production" } = {}) {
  return `HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Path=/`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; ${cookieAttributes()}; Max-Age=0`;
}

export function verifyOpaqueSessionCookie(cookieValue, raw, secret) {
  if (!cookieValue || typeof cookieValue !== "string") return false;
  const expected = `${publicIdFromRaw(raw)}.${signatureForRaw(raw, secret)}`;
  return timingSafeEqual(cookieValue, expected);
}

export function createLoginState() {
  const raw = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + LOGIN_TTL_MS;
  return `${raw}.${expiresAt}.${hmacSha256Hex(hexSecret(), `${raw}:${expiresAt}`)}`;
}

export function verifyLoginState(state) {
  if (typeof state !== "string") return null;
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [raw, expiresAt, signature] = parts;
  const expiry = Number(expiresAt);
  const expected = hmacSha256Hex(secretBytes(), `${raw}:${expiry}`);
  if (Date.now() > expiry) return null;
  if (!timingSafeEqual(signature, expected)) return null;
  const record = loginStates.get(raw);
  loginStates.delete(raw);
  if (!record || record.used) return null;
  record.used = true;
  return { raw, expiresAt, clientIpHash: record.clientIpHash };
}

export function createSessionFromOAuth({ oauthTokenSet, login }) {
  const sessionRecord = createOpaqueSessionId();
  sessions.set(sessionRecord.raw, {
    sessionId: sessionRecord.raw,
    publicId: sessionRecord.publicId,
    userId: login.userId ?? login.login,
    avatarUrl: login.avatarUrl ?? login.avatar_url ?? null,
    accessToken: oauthTokenSet.accessToken,
    permissions: oauthTokenSet.permissions ?? null,
    expiresAt: oauthTokenSet.expiresInSeconds ? Date.now() + oauthTokenSet.expiresInSeconds * 1000 : Date.now() + SESSION_TTL_MS,
    createdAt: Date.now(),
  });
  return { sessionRecord, cookieValue: sessionRecord.cookieValue };
}

export function sessionForRequest(cookieHeader) {
  if (!cookieHeader) return null;
  const name = SESSION_COOKIE;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(cookieHeader));
  if (!match) return null;
  const raw = match[1].split(".")[0];
  const record = sessions.get(raw);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) return null;
  const secret = hexSecretFromEnv();
  if (!secret) return null;
  if (!verifyOpaqueSessionCookie(match[1], raw, secret)) return null;
  return record;
}

export function sessionRemove(cookieHeader) {
  const record = sessionForRequest(cookieHeader);
  if (record) sessions.delete(record.sessionId);
  return clearSessionCookie();
}

export function loginStatePrune() {
  const now = Date.now();
  for (const [key, value] of loginStates) {
    if (value.expiresAt <= now) loginStates.delete(key);
  }
}

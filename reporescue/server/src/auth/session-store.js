import crypto from "node:crypto";

export const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_COOKIE = "reporescue_session";
const SESSION_ID_BYTES = 32;
const SAFE_SESSION_SHARED_SECRET = "RepoRescue/1.0 (opaque signed opaque sessions)";

export function normalizeHexSecret(secret, requiredBytes = 32) {
  const input = String(secret ?? "").trim();
  const expectedLength = requiredBytes * 2;
  if (!/^[0-9a-fA-F]+$/.test(input) || input.length !== expectedLength) {
    return null;
  }
  return Buffer.from(input, "hex");
}

const DEV_FALLBACK_SECRET = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex"
);

export function sessionSecretBytes(fromEnv = process.env.REPORESCUE_SESSION_SECRET) {
  const normalized = normalizeHexSecret(fromEnv);
  if (normalized) return normalized;
  if (process.env.NODE_ENV !== "production") {
    return DEV_FALLBACK_SECRET;
  }
  return null;
}

function signatureForRaw(raw, secretBytes) {
  return crypto.createHmac("sha256", secretBytes).update(SAFE_SESSION_SHARED_SECRET + ":" + String(raw), "utf8").digest("hex");
}

function publicIdFromRaw(raw) {
  return Buffer.from(String(raw), "hex").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createOpaqueSessionId() {
  const raw = crypto.randomBytes(SESSION_ID_BYTES).toString("hex");
  const publicId = publicIdFromRaw(raw);
  const cookieValue = `${publicId}.${signatureForRaw(raw, sessionSecretBytes())}`;
  return { raw, publicId, cookieValue };
}

function timingSafeEqualBuffer(a, b) {
  const aa = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function cookieAttributes({
  secure = process.env.NODE_ENV === "production",
  persistent = false,
  maxAge = DEFAULT_SESSION_MAX_AGE_SECONDS,
} = {}) {
  const securePart = secure ? "; Secure" : "";
  const maxAgePart = persistent ? `; Max-Age=${maxAge}` : "";
  return `HttpOnly; SameSite=Lax${securePart}; Path=/${maxAgePart}`;
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

/** Verify a client-provided "publicId.signature" against the raw server-side id and secret. */
export function verifyOpaqueSessionCookie(cookieValue, raw, secretBytes = sessionSecretBytes()) {
  if (typeof cookieValue !== "string" || !cookieValue) return false;
  const expected = `${publicIdFromRaw(raw)}.${signatureForRaw(raw, secretBytes)}`;
  if (!timingSafeEqualBuffer(cookieValue, expected)) return false;
  return true;
}

export function clearSessionCookie({ secure = process.env.NODE_ENV === "production" } = {}) {
  const securePart = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax${securePart}; Path=/; Max-Age=0`;
}

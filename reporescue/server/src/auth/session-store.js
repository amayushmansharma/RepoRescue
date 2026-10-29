import crypto from "node:crypto";

const SESSION_COOKIE = "reporescue_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60;
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

export function sessionSecretBytes(fromEnv = process.env.REPORESCUE_SESSION_SECRET) {
  return normalizeHexSecret(fromEnv);
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

export function cookieAttributes({ secure = process.env.NODE_ENV === "production" } = {}) {
  const securePart = secure ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax${securePart}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
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

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; ${cookieAttributes()}; Max-Age=0`;
}

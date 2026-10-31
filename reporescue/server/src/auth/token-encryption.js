import crypto from "node:crypto";

const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

// Static dev fallback key used strictly in non-production environments when neither
// REPORESCUE_TOKEN_ENCRYPTION_KEY nor REPORESCUE_SESSION_SECRET is configured.
const DEV_FALLBACK_ENCRYPTION_KEY = Buffer.from(
  "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
  "hex"
);

export function normalizeHexKey(secret, requiredBytes = KEY_LENGTH_BYTES) {
  const input = String(secret ?? "").trim();
  const expectedLength = requiredBytes * 2;
  if (!/^[0-9a-fA-F]+$/.test(input) || input.length !== expectedLength) {
    return null;
  }
  return Buffer.from(input, "hex");
}

/**
 * Resolves the 32-byte key used for AES-256-GCM token encryption.
 * Priority:
 * 1. Dedicated REPORESCUE_TOKEN_ENCRYPTION_KEY (64 hex characters)
 * 2. HKDF derivation from REPORESCUE_SESSION_SECRET (domain-separated info)
 * 3. In non-production only: DEV_FALLBACK_ENCRYPTION_KEY
 */
export function tokenEncryptionKey(env = process.env) {
  const explicit = env.REPORESCUE_TOKEN_ENCRYPTION_KEY?.trim();
  const explicitBuffer = normalizeHexKey(explicit);
  if (explicitBuffer) return explicitBuffer;

  const sessionSecret = env.REPORESCUE_SESSION_SECRET?.trim();
  const sessionSecretBuffer = normalizeHexKey(sessionSecret);
  if (sessionSecretBuffer) {
    return Buffer.from(
      crypto.hkdfSync(
        "sha256",
        sessionSecretBuffer,
        Buffer.alloc(0),
        Buffer.from("RepoRescue/1.0/token-encryption-at-rest", "utf8"),
        KEY_LENGTH_BYTES
      )
    );
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_FALLBACK_ENCRYPTION_KEY;
  }
  return null;
}

/**
 * Encrypts an access token with AES-256-GCM before writing to disk.
 * Binds the ciphertext to the sessionId via Additional Authenticated Data (AAD)
 * to prevent cross-session token splicing.
 *
 * @returns {string} Serialized string: `enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`
 */
export function encryptAccessToken(token, { sessionId, key = tokenEncryptionKey() } = {}) {
  if (!token) return null;
  if (!key) {
    throw new Error(
      "Cannot persist session: Token encryption key is not configured and plaintext storage is disallowed."
    );
  }

  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(AES_256_GCM_ALGORITHM, key, iv);

  if (sessionId) {
    cipher.setAAD(Buffer.from(`session:${sessionId}`, "utf8"));
  }

  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts an encrypted access token string from disk.
 * Detects legacy plaintext strings and flags them for safe migration.
 */
export function decryptAccessToken(encryptedString, { sessionId, key = tokenEncryptionKey() } = {}) {
  if (typeof encryptedString !== "string" || !encryptedString) {
    return { token: null };
  }

  // Handle legacy unencrypted tokens (e.g. from previous sessions before encryption)
  if (!encryptedString.startsWith("enc:v1:")) {
    return { token: encryptedString, isLegacy: true };
  }

  const parts = encryptedString.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    return { error: "INVALID_FORMAT", token: null, isLegacy: false };
  }

  const ivHex = parts[2];
  const tagHex = parts[3];
  const cipherHex = parts[4];

  if (ivHex.length !== IV_LENGTH_BYTES * 2 || tagHex.length !== AUTH_TAG_LENGTH_BYTES * 2) {
    return { error: "INVALID_CIPHERTEXT", token: null, isLegacy: false };
  }

  if (!key) {
    return { error: "MISSING_KEY", token: null, isLegacy: false };
  }

  try {
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(cipherHex, "hex");

    const decipher = crypto.createDecipheriv(AES_256_GCM_ALGORITHM, key, iv);
    if (sessionId) {
      decipher.setAAD(Buffer.from(`session:${sessionId}`, "utf8"));
    }
    decipher.setAuthTag(tag);

    const token = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return { token, isLegacy: false };
  } catch {
    return { error: "DECRYPTION_FAILED", token: null, isLegacy: false };
  }
}

export function isEncryptedToken(value) {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

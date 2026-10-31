import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptAccessToken,
  decryptAccessToken,
  tokenEncryptionKey,
  isEncryptedToken,
} from "../../server/src/auth/token-encryption.js";

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_KEY = Buffer.from(TEST_KEY_HEX, "hex");

test("encryptAccessToken and decryptAccessToken round-trip with dedicated key", () => {
  const rawToken = "gho_test_secret_token_1234567890abcdef";
  const sessionId = "session-test-id-123";

  const encrypted = encryptAccessToken(rawToken, { sessionId, key: TEST_KEY });
  assert.ok(isEncryptedToken(encrypted));
  assert.ok(!encrypted.includes(rawToken), "Ciphertext must never contain the raw token in plaintext");
  assert.ok(encrypted.startsWith("enc:v1:"));

  const decrypted = decryptAccessToken(encrypted, { sessionId, key: TEST_KEY });
  assert.equal(decrypted.error, undefined);
  assert.equal(decrypted.isLegacy, false);
  assert.equal(decrypted.token, rawToken);
});

test("tampered ciphertext, IV, or auth tag fails authentication", () => {
  const rawToken = "gho_tamper_test_token";
  const sessionId = "session-tamper-456";
  const encrypted = encryptAccessToken(rawToken, { sessionId, key: TEST_KEY });

  const parts = encrypted.split(":");
  assert.equal(parts.length, 5);

  // 1. Tampered ciphertext byte
  const badCipherHex = parts[4].slice(0, -2) + (parts[4].endsWith("00") ? "ff" : "00");
  const tamperedCipher = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${badCipherHex}`;
  const res1 = decryptAccessToken(tamperedCipher, { sessionId, key: TEST_KEY });
  assert.equal(res1.error, "DECRYPTION_FAILED");
  assert.equal(res1.token, null);

  // 2. Tampered auth tag byte
  const badTagHex = parts[3].slice(0, -2) + (parts[3].endsWith("00") ? "ff" : "00");
  const tamperedTag = `${parts[0]}:${parts[1]}:${parts[2]}:${badTagHex}:${parts[4]}`;
  const res2 = decryptAccessToken(tamperedTag, { sessionId, key: TEST_KEY });
  assert.equal(res2.error, "DECRYPTION_FAILED");
  assert.equal(res2.token, null);

  // 3. Tampered IV
  const badIvHex = parts[2].slice(0, -2) + (parts[2].endsWith("00") ? "ff" : "00");
  const tamperedIv = `${parts[0]}:${parts[1]}:${badIvHex}:${parts[3]}:${parts[4]}`;
  const res3 = decryptAccessToken(tamperedIv, { sessionId, key: TEST_KEY });
  assert.equal(res3.error, "DECRYPTION_FAILED");
  assert.equal(res3.token, null);
});

test("cross-session splicing fails due to Additional Authenticated Data (AAD) binding", () => {
  const rawToken = "ghu_legit_user_token_999";
  const victimSessionId = "session-victim-aaa";
  const attackerSessionId = "session-attacker-bbb";

  const encrypted = encryptAccessToken(rawToken, { sessionId: victimSessionId, key: TEST_KEY });

  // Attempt to decrypt under a different session ID
  const decrypted = decryptAccessToken(encrypted, { sessionId: attackerSessionId, key: TEST_KEY });
  assert.equal(decrypted.error, "DECRYPTION_FAILED");
  assert.equal(decrypted.token, null);
});

test("encryption key stability: explicit key vs HKDF derivation from session secret", () => {
  // 1. Explicit key
  const env1 = { REPORESCUE_TOKEN_ENCRYPTION_KEY: TEST_KEY_HEX };
  const key1 = tokenEncryptionKey(env1);
  assert.ok(key1);
  assert.equal(key1.toString("hex"), TEST_KEY_HEX);

  // 2. HKDF derivation from session secret
  const env2 = { REPORESCUE_SESSION_SECRET: TEST_KEY_HEX };
  const key2a = tokenEncryptionKey(env2);
  const key2b = tokenEncryptionKey(env2);
  assert.ok(key2a);
  assert.equal(key2a.length, 32);
  assert.equal(key2a.toString("hex"), key2b.toString("hex"), "HKDF derivation must be deterministic and stable across restarts");
  assert.notEqual(key2a.toString("hex"), TEST_KEY_HEX, "Derived token key must be domain-separated from session secret");
});

test("missing or invalid key fails safely without silent plaintext fallback", () => {
  const rawToken = "ghu_important_token";

  assert.throws(
    () => encryptAccessToken(rawToken, { sessionId: "s1", key: null }),
    /Token encryption key is not configured/i
  );

  const decResult = decryptAccessToken("enc:v1:010203040506070809101112:01020304050607080910111213141516:abcdef", {
    sessionId: "s1",
    key: null,
  });
  assert.equal(decResult.error, "MISSING_KEY");
  assert.equal(decResult.token, null);
});

test("legacy unencrypted tokens are identified for safe migration", () => {
  const legacyToken = "gho_plaintext_legacy_oauth_token";
  const result = decryptAccessToken(legacyToken, { sessionId: "any", key: TEST_KEY });
  assert.equal(result.isLegacy, true);
  assert.equal(result.token, legacyToken);
  assert.equal(result.error, undefined);
});

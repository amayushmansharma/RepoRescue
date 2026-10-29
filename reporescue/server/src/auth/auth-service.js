import crypto from "node:crypto";
import { ApiError } from "../http/errors.js";
import { githubAppReady, githubLoginOrigin } from "../github/github-app-config.js";
import { exchangeAuthorizationCode, githubLoginUrl } from "../github/oauth-exchange.js";
import { clearSessionCookie, cookieAttributes, createOpaqueSessionId, sessionCookieName, sessionSecretBytes, verifyOpaqueSessionCookie } from "./session-store.js";

const LOGIN_TTL_MS = 10 * 60 * 1000;
const loginStates = new Map();
const sessions = new Map();

function secretBytes() {
  const bytes = sessionSecretBytes();
  if (!bytes) throw new ApiError("NOT_CONFIGURED", "A 64-hex-character RePoRescue session secret is required before GitHub can be connected.");
  return bytes;
}

function clientId(env = process.env) {
  const id = env.GITHUB_APP_CLIENT_ID?.trim() ?? "";
  if (!id) throw new ApiError("NOT_CONFIGURED", "GITHUB_APP_CLIENT_ID is required.");
  return id;
}

function clientSecret() {
  const secret = process.env.GITHUB_APP_CLIENT_SECRET?.trim() ?? "";
  if (!secret) throw new ApiError("NOT_CONFIGURED", "GITHUB_APP_CLIENT_SECRET is required.");
  return secret;
}

function redirectUri(env = process.env) {
  const url = env.GITHUB_APP_CALLBACK_URL?.trim() ?? "";
  if (!url) throw new ApiError("NOT_CONFIGURED", "GITHUB_APP_CALLBACK_URL is required.");
  return url;
}

function requestSocketDetails(_req = null) {
  return { ip: typeof _req?.headers?.["x-forwarded-for"] === "string" ? _req.headers["x-forwarded-for"].split(",")[0].trim() : "", port: _req?.socket?.localPort ?? 0 };
}

function pruneStates() {
  const now = Date.now();
  for (const [key, value] of loginStates) {
    if (value.expiresAt <= now) loginStates.delete(key);
  }
}

function stateSignature(raw, expiresAt, redirectUriValue, ipPort) {
  return crypto.createHmac("sha256", secretBytes()).update(`${raw}:${expiresAt}:${redirectUriValue}:${ipPort.ip}:${ipPort.port}`, "utf8").digest("hex");
}

export function authorizeUrl(_req, options = {}) {
  if (!githubAppReady()) throw new ApiError("NOT_CONFIGURED", "GitHub App authentication is not configured; connect is disabled.");
  const redirectUriValue = redirectUri();
  const ipPort = requestSocketDetails();
  const raw = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + LOGIN_TTL_MS;
  const signature = stateSignature(raw, expiresAt, redirectUriValue, ipPort);
  const state = `${raw}.${expiresAt}.${signature}`;
  loginStates.set(raw, { expiresAt, redirectUri: redirectUriValue, ipPort, used: false });
  pruneStates();
  const url = githubLoginUrl({
    clientId: clientId(),
    redirectUri: redirectUriValue,
    state,
    scopes: options.scopes ?? "repo",
  });
  return { url, state };
}

function useState(state) {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 3) return { ok: false, url: loginUrlWithError("invalid_state") };
  const [raw, expiresAt, signature] = parts;
  const expiry = Number(expiresAt);
  const record = loginStates.get(raw);
  if (!record || record.used) return { ok: false, url: loginUrlWithError("state_reused") };
  const expected = stateSignature(raw, expiry, record.redirectUri, record.ipPort);
  const match = crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));
  if (!match) return { ok: false, url: loginUrlWithError("state_mismatch") };
  if (Date.now() > record.expiresAt) return { ok: false, url: loginUrlWithError("expired") };
  return { ok: true, record };
}

function loginUrlWithError(reason) {
  const url = new URL("/", githubLoginOrigin());
  url.searchParams.set("auth", reason);
  return url.toString();
}

export function githubCallback({ code, stateCode }) {
  const value = String(code ?? "").trim();
  if (!value || value.length > 100) {
    return { setCookie: clearSessionCookie(), statusCode: 400, url: loginUrlWithError("invalid_code") };
  }
  const stateValue = String(stateCode ?? "").trim();
  if (!stateValue || stateValue.length > 200) {
    return { setCookie: clearSessionCookie(), statusCode: 400, url: loginUrlWithError("invalid_state") };
  }
  const verified = useState(stateValue);
  if (!verified.ok) {
    return { setCookie: clearSessionCookie(), statusCode: 302, url: verified.url };
  }
  const tokenSet = exchangeAuthorizationCode({
    clientId: clientId(),
    clientSecret: clientSecret(),
    code: value,
    redirectUri: verified.record.redirectUri,
  });
  if (!tokenSet?.accessToken) {
    return { setCookie: clearSessionCookie(), statusCode: 502, url: loginUrlWithError("authorization_failed") };
  }
  const sessionRecord = createOpaqueSessionId();
  sessions.set(sessionRecord.raw, {
    sessionId: sessionRecord.raw,
    publicId: sessionRecord.publicId,
    userId: tokenSet.userId ?? tokenSet.login,
    avatarUrl: tokenSet.avatarUrl ?? tokenSet.avatar_url ?? null,
    accessToken: tokenSet.accessToken,
    expiresAt: tokenSet.expiresInSeconds ? Date.now() + tokenSet.expiresInSeconds * 1000 : 0,
    createdAt: Date.now(),
  });
  return { setCookie: `${sessionCookieName()}=${sessionRecord.cookieValue}; ${cookieAttributes()}`, statusCode: 302, url: `${githubLoginOrigin()}/?auth=connected` };
}

export function sessionForRequest(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  const name = sessionCookieName();
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(header));
  if (!match) return null;
  const raw = match[1].split(".")[0];
  const record = sessions.get(raw);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) return null;
  if (!verifyOpaqueSessionCookie(match[1], raw, secretBytes())) return null;
  return record;
}

export function clearSession(req) {
  const record = sessionForRequest(req);
  if (record) sessions.delete(record.sessionId);
  return clearSessionCookie();
}

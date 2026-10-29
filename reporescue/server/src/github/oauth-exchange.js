import { ApiError } from "../http/errors.js";
import { githubLoginOrigin } from "./github-app-config.js";

const GITHUB_UA = "RepoRescue/1.0 (GitHub OAuth Authorization Code Flow)";

export function githubOauthError(status, details) {
  const text = details?.description ?? details?.message ?? `GitHub authorization failed with status ${status}.`;
  if (details?.error === "access_denied") {
    return new ApiError("USER_CANCELLED", "GitHub authorization was not completed.");
  }
  if (/expired|revok/i.test(text)) {
    return new ApiError("SESSION_REQUIRES_REAUTH", "GitHub access expired or was revoked. Reconnect GitHub to continue.");
  }
  if (status === 401 || status === 403) {
    return new ApiError("INSUFFICIENT_PERMISSION", text);
  }
  return new ApiError("UPSTREAM_ERROR", text, { details: { status } });
}

export async function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  timeoutMs = 10_000,
  fetchImplementation = globalThis.fetch,
  loginOrigin = githubLoginOrigin(),
}) {
  const requestBody = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const response = await fetchImplementation(`${loginOrigin}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": GITHUB_UA,
    },
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw githubOauthError(response.status, payload);
  if (!payload || typeof payload !== "object") {
    throw new ApiError("UPSTREAM_ERROR", "GitHub authorization returned an unreadable response.");
  }
  if (payload.error) {
    throw githubOauthError(response.status, payload);
  }
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new ApiError("UPSTREAM_ERROR", "GitHub did not return an authorized user token.");
  }
  return {
    accessToken: payload.access_token,
    expiresInSeconds: Number(payload.expires_in ?? 0) || null,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    scope: typeof payload.scope === "string" ? payload.scope : "",
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "",
  };
}



export function githubLoginUrl({
  clientId,
  redirectUri,
  state,
  scopes = "repo:pull_requests repo:contents repo:metadata",
}) {
  const url = new URL("/login/oauth/authorize", githubLoginOrigin());
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

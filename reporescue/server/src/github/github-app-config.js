export function githubLoginOrigin(env = process.env) {
  return (env.GITHUB_LOGIN_ORIGIN?.trim() || "https://github.com").replace(/\/+$/, "");
}

export function githubApiOrigin(env = process.env) {
  return (env.GITHUB_API_ORIGIN?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

export function githubClientId(env = process.env) {
  return env.GITHUB_CLIENT_ID?.trim() || env.GITHUB_APP_CLIENT_ID?.trim() || "";
}

export function githubClientSecret(env = process.env) {
  return env.GITHUB_CLIENT_SECRET?.trim() || env.GITHUB_APP_CLIENT_SECRET?.trim() || "";
}

export function clientOrigin(req = null, env = process.env) {
  const configured = env.REPORESCUE_CLIENT_ORIGIN?.trim() || env.CLIENT_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (req?.headers?.origin) return req.headers.origin.replace(/\/+$/, "");
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  const proto = req?.headers?.["x-forwarded-proto"] || "http";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  return "http://localhost:5173";
}

export function githubCallbackUrl(req = null, env = process.env) {
  const configured = env.GITHUB_CALLBACK_URL?.trim() || env.GITHUB_APP_CALLBACK_URL?.trim();
  if (configured) return configured;
  return `${clientOrigin(req, env)}/api/auth/github/callback`;
}

export function githubAppReady(env = process.env) {
  const clientId = githubClientId(env);
  const clientSecret = githubClientSecret(env);
  const sessionSecret = env.REPORESCUE_SESSION_SECRET?.trim() || "";
  return Boolean(
    clientId &&
    clientSecret &&
    /^[0-9a-f]{64}$/i.test(sessionSecret)
  );
}

function validateNonSecret(value, name, pattern, description, max = 200) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input || input.length > max || !pattern.test(input)) {
    throw new Error(`${name} must be a valid ${description} (pattern ${String(pattern)}).`);
  }
  return input;
}

const GITHUB_USER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_PATTERN = /^[\w.@()/ -]{1,64}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function validateGithubLogin(value) {
  return validateNonSecret(value, "GitHub login", GITHUB_USER_PATTERN, "GitHub owner or user login");
}

export function validateGithubName(value) {
  return validateNonSecret(value, "GitHub repository name", GITHUB_NAME_PATTERN, "GitHub repository name");
}

export function validateBranchName(value) {
  return validateNonSecret(value, "branch", BRANCH_PATTERN, "Git branch name");
}

export function validateSha(value) {
  return validateNonSecret(value, "commit SHA", SHA_PATTERN, "Git commit SHA");
}

export function validatePathSegment(value, name = "path") {
  return validateNonSecret(value, name, /^[\w.@()/ -]{1,250}$/, "repository file path");
}

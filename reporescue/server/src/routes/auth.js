import { Router } from "express";
import { asyncHandler, sendOk } from "../http/errors.js";
import { authorizeUrl, clearSession, githubCallback, sessionForRequest } from "../auth/auth-service.js";
import { githubAppReady } from "../github/github-app-config.js";
import { rateLimit } from "../middleware/rate-limit.js";

const AUTH_SCOPES = "repo";

export const authRouter = Router();

authRouter.get(
  "/github/login",
  rateLimit({ scope: "auth-login", limit: 20, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const scopes = typeof req.query.scope === "string" && req.query.scope.trim()
      ? req.query.scope.trim().slice(0, 100)
      : AUTH_SCOPES;
    if (!githubAppReady()) {
      res.status(503).json({ ok: false, error: { code: "NOT_CONFIGURED", message: "GitHub App authentication is not configured on this server." } });
      return;
    }
    const { url } = authorizeUrl(req, { scopes });
    res.redirect(302, url);
  }),
);

authRouter.get(
  "/github/callback",
  rateLimit({ scope: "auth-callback", limit: 20, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (req.query.error === "access_denied") {
      res.redirect(`/?auth=cancelled&returnTo=${encodeURIComponent("/")}`);
      return;
    }
    const result = githubCallback({ code, stateCode: state, req });
    res.setHeader("Set-Cookie", result.setCookie);
    res.redirect(result.statusCode, result.url);
  }),
);

authRouter.post(
  "/logout",
  rateLimit({ scope: "auth-logout", limit: 30, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    res.setHeader("Set-Cookie", clearSession(req));
    sendOk(res, { loggedOut: true });
  }),
);

authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const session = sessionForRequest(req);
    if (!session) {
      sendOk(res, { authenticated: false, login: null, avatarUrl: null });
      return;
    }
    sendOk(res, { authenticated: true, login: session.userId, avatarUrl: session.avatarUrl });
  }),
);

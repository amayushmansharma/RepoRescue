import { Router } from "express";
import { asyncHandler, sendOk } from "../http/errors.js";
import { authorizeUrl, clearSession, githubCallback, sessionForRequest, _createTestSession } from "../auth/auth-service.js";
import { cookieAttributes } from "../auth/session-store.js";
import { githubAppReady, githubClientId } from "../github/github-app-config.js";
import { rateLimit } from "../middleware/rate-limit.js";

const AUTH_SCOPES = "read:user public_repo";

export const authRouter = Router();

authRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const ready = githubAppReady();
    sendOk(res, {
      configured: ready,
      provider: "github",
      scopes: AUTH_SCOPES,
      clientId: ready ? `${githubClientId().slice(0, 8)}...` : null,
    });
  }),
);

authRouter.get(
  "/github/login",
  rateLimit({ scope: "auth-login", limit: 20, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    if (!githubAppReady()) {
      res.status(503).json({
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message: "GitHub OAuth authentication is not configured on this server.",
        },
      });
      return;
    }
    const remember = req.query.remember === "true" || req.query.remember === "1";
    const { url } = authorizeUrl(req, { scopes: AUTH_SCOPES, remember });
    if (req.headers.accept?.includes("application/json")) {
      sendOk(res, { url, remember });
      return;
    }
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
      res.redirect("/login?auth=access_denied");
      return;
    }
    const result = await githubCallback({ code, stateCode: state, req });
    if (result.setCookie) {
      res.setHeader("Set-Cookie", result.setCookie);
    }
    res.redirect(result.statusCode, result.url);
  }),
);

authRouter.post(
  "/logout",
  rateLimit({ scope: "auth-logout", limit: 30, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    res.setHeader("Set-Cookie", await clearSession(req));
    sendOk(res, { loggedOut: true });
  }),
);

authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const session = sessionForRequest(req);
    if (!session) {
      if (req.headers.cookie && req.headers.cookie.includes("reporescue_session=")) {
        res.setHeader("Set-Cookie", await clearSession(req));
      }
      sendOk(res, {
        authenticated: false,
        user: null,
        scopes: [],
        hasWriteScope: false,
        requiresReauth: false,
        remember: false,
      });
      return;
    }
    const scopesList = String(session.scope || "")
      .split(/[\s,]+/)
      .filter(Boolean);
    const hasWriteScope = scopesList.includes("public_repo") || scopesList.includes("repo");
    sendOk(res, {
      authenticated: true,
      user: {
        login: session.userId,
        name: session.name,
        avatarUrl: session.avatarUrl,
      },
      scopes: scopesList,
      hasWriteScope,
      requiresReauth: !hasWriteScope,
      remember: Boolean(session.remember),
      expiresAt: session.expiresAt,
    });
  }),
);

if (process.env.NODE_ENV !== "production") {
  authRouter.post(
    "/dev-login",
    asyncHandler(async (req, res) => {
      const login = typeof req.body?.login === "string" ? req.body.login : "octocat";
      const name = typeof req.body?.name === "string" ? req.body.name : "The Octocat";
      const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl : "https://avatars.githubusercontent.com/u/583231?v=4";
      const remember = Boolean(req.body?.remember);
      const session = _createTestSession({ login, name, avatarUrl, remember });
      res.setHeader("Set-Cookie", `${session.cookieHeader}; ${cookieAttributes({ persistent: remember })}`);
      sendOk(res, { login, name, avatarUrl, remember });
    }),
  );
}

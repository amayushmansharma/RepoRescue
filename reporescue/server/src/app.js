import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_JSON_BODY_BYTES, sendError } from "./http/errors.js";
import { pullRequestsRouter, remediationsRouter, verificationsRouter } from "./routes/remediations.js";
import { authRouter } from "./routes/auth.js";
import { scansRouter } from "./routes/scans.js";
import { systemRouter } from "./routes/system.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express application without binding a port, so API tests can
 * exercise it in-process and `server.js` stays a thin entry point.
 */
export function createApp(options = {}) {
  const app = express();
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? "";
  const clientDist = options.clientDist ?? path.resolve(here, "../../client/dist");

  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ?? false);

  // Security headers on every response. Framing is allowed by default so the
  // app can be embedded in a hosted preview; set FRAME_ANCESTORS="'none'" to deny.
  const frameAncestors = (options.frameAncestors ?? process.env.FRAME_ANCESTORS ?? "").trim();
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(frameAncestors ? [`frame-ancestors ${frameAncestors}`] : []),
  ].join("; ");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Content-Security-Policy": csp,
      ...(frameAncestors === "'none'" ? { "X-Frame-Options": "DENY" } : {}),
    });
    next();
  });

  // Same-origin by default (the Vite dev server proxies /api). A single explicit
  // client origin can be allowed for split deployments; never a wildcard.
  if (clientOrigin) {
    app.use((req, res, next) => {
      if (req.headers.origin === clientOrigin) {
        res.set({
          "Access-Control-Allow-Origin": clientOrigin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          Vary: "Origin",
        });
      }
      if (req.method === "OPTIONS") return res.sendStatus(204);
      return next();
    });
  }

  app.use(express.json({ limit: MAX_JSON_BODY_BYTES, type: "application/json" }));

  app.use("/api", systemRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/scans", scansRouter);
  app.use("/api/remediations", remediationsRouter);
  app.use("/api/pull-requests", pullRequestsRouter);
  app.use("/api/verifications", verificationsRouter);

  app.all("/api/*splat", (_req, res) => {
    res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown API route." } });
  });

  // Production: serve the built Vite client with an SPA fallback.
  if (options.serveClient ?? fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist, { index: "index.html", maxAge: "1h" }));
    app.get("*splat", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  // Central error handler: typed errors become JSON; everything else is 500.
  app.use((error, _req, res, _next) => {
    sendError(res, error);
  });

  return app;
}

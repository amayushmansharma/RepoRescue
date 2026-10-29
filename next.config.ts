import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Framing policy.
 *
 * The hosted preview renders the app inside an iframe on another origin, so
 * blocking all frame ancestors makes the preview blank. Framing is therefore
 * allowed by default and can be locked down per deployment:
 *
 *   FRAME_ANCESTORS="'none'"                         → deny all embedding
 *   FRAME_ANCESTORS="'self' https://trusted.example" → allow listed origins
 *
 * Every other header below is always applied.
 */
const frameAncestors = process.env.FRAME_ANCESTORS?.trim();

const cspDirectives = [
  "default-src 'self'",
  // Next.js hydration needs inline scripts; no third-party script origins are allowed.
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(frameAncestors ? [`frame-ancestors ${frameAncestors}`] : []),
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
  ...(frameAncestors === "'none'" ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

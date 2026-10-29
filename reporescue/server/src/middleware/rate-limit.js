import { ApiError } from "../http/errors.js";

const buckets = new Map();

export function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim().slice(0, 64);
  return (req.ip ?? "local").slice(0, 64);
}

/**
 * Fixed-window, in-process limiter. This application runs as a single Node
 * process; the goal is to stop scan abuse, not to build a distributed quota.
 */
export function rateLimit({ scope, limit, windowMs }) {
  return (req, _res, next) => {
    const now = Date.now();
    const key = `${scope}:${clientKey(req)}`;
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= limit) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      return next(new ApiError("RATE_LIMITED", `Too many ${scope} requests. Try again in ${retryAfterSeconds}s.`, { retryAfterSeconds }));
    }
    current.count += 1;
    return next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}

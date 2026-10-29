import { ApiError } from "./errors";

type Bucket = { count: number; resetAt: number };

const globalForLimit = globalThis as typeof globalThis & {
  __repoRescueRateBuckets?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
  globalForLimit.__repoRescueRateBuckets ??= new Map();
  return globalForLimit.__repoRescueRateBuckets;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
  return request.headers.get("x-real-ip")?.slice(0, 64) ?? "local";
}

/**
 * Fixed-window limiter. Deliberately in-process: this deployment has one
 * server instance and the goal is to stop scan abuse, not to build a
 * distributed quota system.
 */
export function enforceRateLimit(
  request: Request,
  options: { scope: string; limit: number; windowMs: number },
): void {
  const now = Date.now();
  const key = `${options.scope}:${clientKey(request)}`;
  const store = buckets();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  if (current.count >= options.limit) {
    throw new ApiError("RATE_LIMITED", `Too many ${options.scope} requests. Try again in ${Math.ceil((current.resetAt - now) / 1000)}s.`, {
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
    });
  }
  current.count += 1;
}

export function rateLimitSnapshot(): { trackedClients: number } {
  return { trackedClients: buckets().size };
}

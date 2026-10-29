/**
 * Typed API errors and the single JSON envelope used by every endpoint:
 *   { ok: true, data }            on success
 *   { ok: false, error: {...} }   on failure
 * Stack traces, connection strings and upstream payloads are never returned.
 */

const STATUS_BY_CODE = {
  INVALID_INPUT: 400,
  INVALID_REPOSITORY: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  REPOSITORY_NOT_FOUND: 404,
  REPOSITORY_FORBIDDEN: 403,
  GITHUB_UNAUTHORIZED: 502,
  GITHUB_RATE_LIMITED: 429,
  GITHUB_UNAVAILABLE: 502,
  GITHUB_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  PAYLOAD_TOO_LARGE: 413,
  STORAGE_UNAVAILABLE: 503,
  NO_REMEDIATION: 422,
  NOT_CONFIGURED: 501,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function sendOk(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

export function toErrorBody(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        },
      },
    };
  }
  // body-parser errors
  if (error && error.type === "entity.too.large") {
    return { status: 413, body: { ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is larger than the 64 KB limit." } } };
  }
  if (error && error.type === "entity.parse.failed") {
    return { status: 400, body: { ok: false, error: { code: "INVALID_INPUT", message: "Request body must be valid JSON." } } };
  }
  console.error("[reporescue] unhandled error:", error instanceof Error ? error.message : typeof error);
  return {
    status: 500,
    body: { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong while processing the request." } },
  };
}

export function sendError(res, error) {
  const { status, body } = toErrorBody(error);
  if (body.error.retryAfterSeconds) res.set("Retry-After", String(body.error.retryAfterSeconds));
  res.status(status).json(body);
}

export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Returns the parsed JSON object body or throws a typed 400. */
export function readJsonBody(req) {
  if (!req.is("application/json")) {
    throw new ApiError("INVALID_INPUT", "Expected Content-Type: application/json.");
  }
  const body = req.body;
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_INPUT", "Request body must be a JSON object.");
  }
  return body;
}

export function ensureString(value, field, options = {}) {
  if (typeof value !== "string") {
    throw new ApiError("INVALID_INPUT", `"${field}" must be a string.`, { details: { field } });
  }
  const trimmed = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 300;
  if (trimmed.length < min) throw new ApiError("INVALID_INPUT", `"${field}" is required.`, { details: { field } });
  if (trimmed.length > max) throw new ApiError("INVALID_INPUT", `"${field}" must be at most ${max} characters.`, { details: { field } });
  return trimmed;
}

export function ensureStringArray(value, field, options = {}) {
  if (!Array.isArray(value)) {
    throw new ApiError("INVALID_INPUT", `"${field}" must be an array of strings.`, { details: { field } });
  }
  const itemMax = options.itemMaxLength ?? 120;
  const maxItems = options.maxItems ?? 40;
  if (value.length > maxItems) {
    throw new ApiError("INVALID_INPUT", `"${field}" may contain at most ${maxItems} entries.`, { details: { field } });
  }
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > itemMax) {
      throw new ApiError("INVALID_INPUT", `"${field}" must contain non-empty strings.`, { details: { field } });
    }
  }
  const unique = Array.from(new Set(value.map((item) => item.trim())));
  const minItems = options.minItems ?? 0;
  if (unique.length < minItems) {
    throw new ApiError("INVALID_INPUT", `"${field}" must contain at least ${minItems} entr${minItems === 1 ? "y" : "ies"}.`, { details: { field } });
  }
  return unique;
}

export function ensureObject(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("INVALID_INPUT", `"${field}" must be an object.`, { details: { field } });
  }
  return value;
}

/**
 * Selection endpoints accept identifiers only. Patches and validation results
 * are regenerated server-side from the stored scan, so a client can never
 * claim that arbitrary content was validated.
 */
export function readSelection(req, { requireScanId = true } = {}) {
  const body = readJsonBody(req);
  const scanId = requireScanId ? ensureString(body.scanId, "scanId", { max: 64 }) : undefined;
  if (!Array.isArray(body.findingIds)) {
    throw new ApiError("INVALID_INPUT", '"findingIds" must be an array of finding identifiers.', { details: { field: "findingIds" } });
  }
  const findingIds = ensureStringArray(body.findingIds, "findingIds", { minItems: 1, maxItems: 30, itemMaxLength: 80 });
  const verificationId = typeof body.verificationId === "string" && body.verificationId.trim() ? body.verificationId.trim() : undefined;
  return { scanId, findingIds, verificationId };
}

/** Wraps an async Express handler so rejections reach the error middleware. */
export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

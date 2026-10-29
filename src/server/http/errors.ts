import { NextResponse } from "next/server";

export type ErrorCode =
  | "INVALID_INPUT"
  | "INVALID_REPOSITORY"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_FORBIDDEN"
  | "GITHUB_UNAUTHORIZED"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "STORAGE_UNAVAILABLE"
  | "NO_REMEDIATION"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
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
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;
  retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; retryAfterSeconds?: number; status?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        },
      },
      { status: error.status },
    );
  }

  // Never leak stack traces, connection strings or upstream payloads.
  console.error("[reborescue] unhandled error", error instanceof Error ? error.message : typeof error);
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong while processing the request." } },
    { status: 500 },
  );
}

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError("INVALID_INPUT", "Expected Content-Type: application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is larger than the 64 KB limit.");
  }
  const raw = await request.text();
  if (raw.length > MAX_JSON_BODY_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is larger than the 64 KB limit.");
  }
  if (!raw.trim()) {
    throw new ApiError("INVALID_INPUT", "Request body must not be empty.");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
  }
}

export function ensureString(value: unknown, field: string, options: { min?: number; max?: number } = {}): string {
  if (typeof value !== "string") {
    throw new ApiError("INVALID_INPUT", `"${field}" must be a string.`, { details: { field } });
  }
  const trimmed = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 300;
  if (trimmed.length < min) {
    throw new ApiError("INVALID_INPUT", `"${field}" is required.`, { details: { field } });
  }
  if (trimmed.length > max) {
    throw new ApiError("INVALID_INPUT", `"${field}" must be at most ${max} characters.`, { details: { field } });
  }
  return trimmed;
}

export function ensureStringArray(
  value: unknown,
  field: string,
  options: { minItems?: number; maxItems?: number; itemMaxLength?: number } = {},
): string[] {
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
  if (unique.length < (options.minItems ?? 0)) {
    throw new ApiError("INVALID_INPUT", `"${field}" must contain at least ${options.minItems} entr${options.minItems === 1 ? "y" : "ies"}.`, {
      details: { field },
    });
  }
  return unique;
}

export function ensureObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("INVALID_INPUT", `"${field}" must be an object.`, { details: { field } });
  }
  return value as Record<string, unknown>;
}

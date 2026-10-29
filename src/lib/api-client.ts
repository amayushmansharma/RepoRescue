import type {
  ApiResponse,
  ScanProgress,
  DemoRepository,
  PullRequestDraft,
  RemediationProposal,
  ScanDetail,
  ScanHistoryItem,
  ValidationCheck,
  VerificationRecord,
} from "./types";

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;
  retryAfterSeconds?: number;

  constructor(message: string, options: { code?: string; status?: number; details?: unknown; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "ApiClientError";
    this.code = options.code ?? "CLIENT_ERROR";
    this.status = options.status ?? 0;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError("The request could not be sent. Check your connection and try again.", { code: "NETWORK_ERROR" });
  }

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    payload = null;
  }

  if (!payload) {
    throw new ApiClientError(`The server returned an unreadable response (status ${response.status}).`, { status: response.status });
  }
  if (!payload.ok) {
    throw new ApiClientError(payload.error.message, {
      code: payload.error.code,
      status: response.status,
      details: payload.error.details,
      retryAfterSeconds: payload.error.retryAfterSeconds,
    });
  }
  return payload.data;
}

export type DemosPayload = { repositories: DemoRepository[]; note: string };
export type ScanPayload = {
  scan: ScanDetail;
  meta: { durationMs: number; storage: "database" | "memory"; accessMode: string; requestOrigin?: string };
};
export type PreviewPayload = {
  scanId: string;
  repository: string;
  mode: "demo" | "live";
  proposals: RemediationProposal[];
  unresolved: { findingId: string; reason: string }[];
  totals: {
    proposals: number;
    patchProposals: number;
    manualProposals: number;
    files: number;
    additions: number;
    deletions: number;
    validationPassed: number;
    validationFailed: number;
    validationSkipped: number;
  };
  boundaryNote: string;
};
export type ValidatePayload = {
  scanId: string;
  repository: string;
  filesConsidered: string[];
  results: {
    proposalId: string;
    findingId: string;
    kind: "patch" | "manual";
    overallValidation: "passed" | "failed" | "skipped" | "unavailable";
    checks: ValidationCheck[];
    files: { path: string; changeType: "create" | "modify" }[];
    limitations: string[];
  }[];
  summary: { proposals: number; passed: number; failed: number; skipped: number };
  note: string;
};
export type PrPayload = { draft: PullRequestDraft; mode: "demo" | "live"; verificationId: string | null; performedRemoteWrites: false };

export const api = {
  listDemos: () => request<DemosPayload>("/api/demo-repositories"),
  listScans: () => request<{ scans: ScanHistoryItem[]; count: number }>("/api/scans"),
  createDemoScan: (demoId: string, progressId?: string) =>
    request<ScanPayload>("/api/scans", { method: "POST", body: JSON.stringify({ mode: "demo", demoId, ...(progressId ? { progressId } : {}) }) }),
  createLiveScan: (repository: string, progressId?: string) =>
    request<ScanPayload>("/api/scans", { method: "POST", body: JSON.stringify({ mode: "live", repository, ...(progressId ? { progressId } : {}) }) }),
  getScanProgress: (progressId: string, signal?: AbortSignal) =>
    request<ScanProgress>(`/api/scans/progress/${encodeURIComponent(progressId)}`, { signal }),
  getScan: (scanId: string) => request<{ scan: ScanDetail }>(`/api/scans/${encodeURIComponent(scanId)}`),
  rescan: (scanId: string) =>
    request<{ scan: ScanDetail; meta: { previousScanId: string; previousScore: number; storage: string } }>(
      `/api/scans/${encodeURIComponent(scanId)}/rescan`,
      { method: "POST" },
    ),
  preview: (scanId: string, findingIds: string[], signal?: AbortSignal) =>
    request<PreviewPayload>("/api/remediations/preview", {
      method: "POST",
      body: JSON.stringify({ scanId, findingIds }),
      signal,
    }),
  validate: (scanId: string, findingIds: string[]) =>
    request<ValidatePayload>("/api/remediations/validate", {
      method: "POST",
      body: JSON.stringify({ scanId, findingIds }),
    }),
  prPreview: (scanId: string, findingIds: string[], verificationId?: string | null) =>
    request<PrPayload>("/api/pull-requests/preview", {
      method: "POST",
      body: JSON.stringify({ scanId, findingIds, ...(verificationId ? { verificationId } : {}) }),
    }),
  runVerification: (scanId: string, findingIds: string[]) =>
    request<{ verification: VerificationRecord; storage: string }>("/api/verifications", {
      method: "POST",
      body: JSON.stringify({ scanId, findingIds }),
    }),
  getVerification: (verificationId: string) =>
    request<{ verification: VerificationRecord }>(`/api/verifications/${encodeURIComponent(verificationId)}`),
  exportReview: async (scanId: string, findingIds: string[]): Promise<{ blob: Blob; filename: string }> => {
    let response: Response;
    try {
      response = await fetch(`/api/scans/${encodeURIComponent(scanId)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingIds }),
        cache: "no-store",
      });
    } catch {
      throw new ApiClientError("The review export could not be requested. Check your connection and try again.", {
        code: "NETWORK_ERROR",
      });
    }

    if (!response.ok) {
      try {
        const payload = (await response.json()) as ApiResponse<never>;
        if (!payload.ok) {
          throw new ApiClientError(payload.error.message, {
            code: payload.error.code,
            status: response.status,
            details: payload.error.details,
            retryAfterSeconds: payload.error.retryAfterSeconds,
          });
        }
      } catch (error) {
        if (error instanceof ApiClientError) throw error;
      }
      throw new ApiClientError(`The review export failed (status ${response.status}).`, { status: response.status });
    }

    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "reborescue-review-export.zip";
    return { blob: await response.blob(), filename };
  },
};

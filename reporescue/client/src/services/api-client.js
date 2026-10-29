export class ApiClientError extends Error {
    code;
    status;
    details;
    retryAfterSeconds;
    constructor(message, options = {}) {
        super(message);
        this.name = "ApiClientError";
        this.code = options.code ?? "CLIENT_ERROR";
        this.status = options.status ?? 0;
        this.details = options.details;
        this.retryAfterSeconds = options.retryAfterSeconds;
    }
}
async function request(path, init) {
    let response;
    try {
        response = await fetch(path, {
            ...init,
            headers: {
                ...(init?.body ? { "Content-Type": "application/json" } : {}),
                ...(init?.headers ?? {}),
            },
            cache: "no-store",
        });
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
            throw error;
        throw new ApiClientError("The request could not be sent. Check your connection and try again.", { code: "NETWORK_ERROR" });
    }
    let payload = null;
    try {
        payload = (await response.json());
    }
    catch (error) {
        if (init?.signal?.aborted) throw error;
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
export const api = {
    listDemos: () => request("/api/demo-repositories"),
  capabilities: () => request("/api/config/capabilities"),
    listScans: () => request("/api/scans"),
    createDemoScan: (demoId, progressId, signal) => request("/api/scans", {
            method: "POST",
            body: JSON.stringify({ mode: "demo", demoId, ...(progressId ? { progressId } : {}) }),
            signal,
        }),
    createLiveScan: (repository, progressId, signal) => request("/api/scans", {
            method: "POST",
            body: JSON.stringify({ mode: "live", repository, ...(progressId ? { progressId } : {}) }),
            signal,
        }),
    getScanProgress: (progressId, signal) => request(`/api/scans/progress/${encodeURIComponent(progressId)}`, { signal }),
    getScan: (scanId, signal) => request(`/api/scans/${encodeURIComponent(scanId)}`, { signal }),
    rescan: (scanId) => request(`/api/scans/${encodeURIComponent(scanId)}/rescan`, { method: "POST" }),
    preview: (scanId, findingIds, signal) => request("/api/remediations/preview", {
        method: "POST",
        body: JSON.stringify({ scanId, findingIds }),
        signal,
    }),
    validate: (scanId, findingIds) => request("/api/remediations/validate", {
        method: "POST",
        body: JSON.stringify({ scanId, findingIds }),
    }),
    prPreview: (scanId, findingIds, verificationId) => request("/api/pull-requests/preview", {
        method: "POST",
        body: JSON.stringify({ scanId, findingIds, ...(verificationId ? { verificationId } : {}) }),
    }),
    runVerification: (scanId, findingIds) => request("/api/verifications", {
        method: "POST",
        body: JSON.stringify({ scanId, findingIds }),
    }),
    getVerification: (verificationId) => request(`/api/verifications/${encodeURIComponent(verificationId)}`),
    exportReview: async (scanId, findingIds) => {
        let response;
        try {
            response = await fetch(`/api/scans/${encodeURIComponent(scanId)}/export`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ findingIds }),
                cache: "no-store",
            });
        }
        catch {
            throw new ApiClientError("The review export could not be requested. Check your connection and try again.", {
                code: "NETWORK_ERROR",
            });
        }
        if (!response.ok) {
            try {
                const payload = (await response.json());
                if (!payload.ok) {
                    throw new ApiClientError(payload.error.message, {
                        code: payload.error.code,
                        status: response.status,
                        details: payload.error.details,
                        retryAfterSeconds: payload.error.retryAfterSeconds,
                    });
                }
            }
            catch (error) {
                if (error instanceof ApiClientError)
                    throw error;
            }
            throw new ApiClientError(`The review export failed (status ${response.status}).`, { status: response.status });
        }
        const disposition = response.headers.get("content-disposition") ?? "";
        const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "reborescue-review-export.zip";
        return { blob: await response.blob(), filename };
    },
};

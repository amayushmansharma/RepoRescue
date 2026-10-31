import { buildSnapshot } from "../analysis/snapshot.js";
import { ApiError } from "../http/errors.js";
const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";
const REQUEST_TIMEOUT_MS = 9_000;
const MAX_FILES = 24;
const MAX_FILE_BYTES = 160_000;
const MAX_TOTAL_BYTES = 900_000;
const MAX_TREE_ENTRIES = 25_000;
const PRIORITY_PATTERNS = [
    /^readme(\.(md|markdown|rst|txt))?$/i,
    /^license(\.(md|txt))?$/i,
    /^licence(\.(md|txt))?$/i,
    /^copying(\.(md|txt))?$/i,
    /^contributing(\.(md|rst|txt))?$/i,
    /^code_of_conduct(\.md)?$/i,
    /^\.github\/code_of_conduct(\.md)?$/i,
    /^package\.json$/,
    /^package-lock\.json$/,
    /^pnpm-lock\.yaml$/,
    /^yarn\.lock$/,
    /^tsconfig\.json$/,
    /^pyproject\.toml$/,
    /^requirements[^/]*\.txt$/,
    /^poetry\.lock$/,
    /^pom\.xml$/,
    /^build\.gradle(\.kts)?$/,
    /^go\.mod$/,
    /^Cargo\.toml$/,
    /^\.gitignore$/,
    /^\.env\.(example|sample|template)$/i,
    /^PULL_REQUEST_TEMPLATE\.md$/i,
    /^\.github\/PULL_REQUEST_TEMPLATE\.md$/i,
];
const SOURCE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|rb|php)$/i;
function authHeaders(token) {
    return {
        Accept: "application/vnd.github+json",
        "User-Agent": "RepoRescue/1.0 (read-only repository analysis)",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}
export function githubRateLimitError(token, retryAfterSeconds) {
    const mins = retryAfterSeconds ? Math.ceil(retryAfterSeconds / 60) : 15;
    const message = token
        ? `GitHub API rate limit reached for this session (5,000 requests/hour). Please try again in approximately ${mins} minute(s).`
        : `GitHub API rate limit reached for anonymous scanning (60 requests/hour). Sign in with GitHub for 5,000 requests/hour, or try again in approximately ${mins} minute(s).`;
    return new ApiError("GITHUB_RATE_LIMITED", message, { retryAfterSeconds });
}

async function githubFetch(path, token) {
    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            headers: authHeaders(token),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        });
    }
    catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
            throw new ApiError("GITHUB_TIMEOUT", "GitHub did not respond within 9 seconds. Try again shortly.");
        }
        throw new ApiError("GITHUB_UNAVAILABLE", "GitHub could not be reached from this environment.");
    }
    if (response.ok)
        return response;
    const retryAfter = Number(response.headers.get("retry-after") ?? "");
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset") ?? "");
    const resetIn = Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) : 0;
    if (response.status === 404) {
        throw new ApiError("REPOSITORY_NOT_FOUND", "GitHub could not find that public repository. Check the owner and repository name.");
    }
    if (response.status === 403 || response.status === 429 || remaining === "0") {
        const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.ceil(resetIn / 1000) || undefined;
        throw githubRateLimitError(token, seconds);
    }
    if (response.status === 401) {
        throw new ApiError("GITHUB_UNAUTHORIZED", "The configured GitHub token was rejected. Live scanning is unavailable until it is corrected.");
    }
    if (response.status === 410 || response.status === 451) {
        throw new ApiError("REPOSITORY_FORBIDDEN", "GitHub reports that this repository is unavailable.");
    }
    if (response.status >= 500) {
        throw new ApiError("GITHUB_UNAVAILABLE", "GitHub returned a server error while reading the repository.");
    }
    throw new ApiError("UPSTREAM_ERROR", `GitHub rejected the request (status ${response.status}).`);
}
function readString(value, fallback = "") {
    return typeof value === "string" ? value.slice(0, 500) : fallback;
}
export function mapGithubRepository(payload) {
    if (typeof payload !== "object" || payload === null) {
        throw new ApiError("UPSTREAM_ERROR", "GitHub returned an unexpected repository payload.");
    }
    const repo = payload;
    const owner = repo.owner?.login;
    const name = repo.name;
    if (typeof owner !== "string" || typeof name !== "string") {
        throw new ApiError("UPSTREAM_ERROR", "GitHub repository payload is missing identity fields.");
    }
    const license = repo.license;
    const topics = Array.isArray(repo.topics) ? repo.topics.filter((topic) => typeof topic === "string").slice(0, 20) : [];
    return {
        owner,
        name,
        fullName: readString(repo.full_name, `${owner}/${name}`),
        url: readString(repo.html_url, `https://github.com/${owner}/${name}`),
        defaultBranch: readString(repo.default_branch, "main"),
        description: repo.description ? readString(repo.description, "") : null,
        topics,
        license: license && typeof license.spdx_id === "string" && license.spdx_id !== "NOASSERTION"
            ? { spdxId: license.spdx_id, name: readString(license.name, license.spdx_id) }
            : null,
        stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0,
        openIssues: typeof repo.open_issues_count === "number" ? repo.open_issues_count : 0,
        pushedAt: typeof repo.pushed_at === "string" ? repo.pushed_at : null,
        primaryLanguage: typeof repo.language === "string" ? repo.language : null,
        fixture: false,
    };
}
export async function fetchRepositorySnapshot(repository, token) {
    const accessMode = token ? "authenticated" : "anonymous";
    const warnings = [];
    const repoResponse = await githubFetch(`/repos/${repository.owner}/${repository.name}`, token);
    const meta = mapGithubRepository(await repoResponse.json());
    const treeResponse = await githubFetch(`/repos/${repository.owner}/${repository.name}/git/trees/${encodeURIComponent(meta.defaultBranch)}?recursive=1`, token);
    const treePayload = (await treeResponse.json());
    if (!Array.isArray(treePayload.tree)) {
        throw new ApiError("UPSTREAM_ERROR", "GitHub returned an unexpected file tree payload.");
    }
    if (treePayload.truncated) {
        warnings.push("GitHub truncated the recursive file tree; the file listing analysed here is partial.");
    }
    if (treePayload.tree.length > MAX_TREE_ENTRIES) {
        warnings.push(`Only the first ${MAX_TREE_ENTRIES} tree entries were considered.`);
    }
    const blobs = treePayload.tree
        .slice(0, MAX_TREE_ENTRIES)
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => ({
        path: entry.path,
        size: typeof entry.size === "number" ? entry.size : 0,
    }));
    const tree = blobs.map((blob) => blob.path);
    const selected = [];
    for (const pattern of PRIORITY_PATTERNS) {
        for (const blob of blobs) {
            if (selected.length >= MAX_FILES)
                break;
            if (pattern.test(blob.path) && !selected.some((candidate) => candidate.path === blob.path) && blob.size <= MAX_FILE_BYTES) {
                selected.push(blob);
            }
        }
    }
    for (const blob of blobs) {
        if (selected.length >= MAX_FILES)
            break;
        if (SOURCE_PATTERN.test(blob.path) && blob.size <= MAX_FILE_BYTES && !selected.some((candidate) => candidate.path === blob.path)) {
            selected.push(blob);
        }
    }
    const files = [];
    let totalBytes = 0;
    let skippedBinary = 0;
    for (const candidate of selected) {
        if (totalBytes >= MAX_TOTAL_BYTES) {
            warnings.push("The repository content budget was reached; not every candidate file was downloaded.");
            break;
        }
        const encodedPath = candidate.path.split("/").map(encodeURIComponent).join("/");
        try {
            const response = await fetch(`${RAW_BASE}/${repository.owner}/${repository.name}/${encodeURIComponent(meta.defaultBranch)}/${encodedPath}`, {
                headers: {
                    "User-Agent": "RepoRescue/1.0",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                cache: "no-store",
            });
            if (!response.ok) {
                warnings.push(`Could not read ${candidate.path} (status ${response.status}).`);
                continue;
            }
            const buffer = await response.arrayBuffer();
            const bytes = Buffer.from(buffer);
            if (bytes.includes(0)) {
                skippedBinary += 1;
                continue;
            }
            const content = bytes.toString("utf8").slice(0, MAX_FILE_BYTES);
            totalBytes += bytes.byteLength;
            files.push({ path: candidate.path, content });
        }
        catch {
            warnings.push(`Timed out reading ${candidate.path}.`);
        }
    }
    if (skippedBinary > 0)
        warnings.push(`${skippedBinary} binary file(s) were skipped.`);
    if (files.length === 0) {
        throw new ApiError("UPSTREAM_ERROR", "None of the files needed for analysis could be read. The repository may be empty or GitHub may be blocking raw downloads.");
    }
    const snapshot = buildSnapshot({
        repository: meta,
        files,
        tree,
        mode: "live",
        fetchedAt: new Date().toISOString(),
        analysisLimitations: [
            `Live scan via the GitHub REST API using ${accessMode} access.`,
            `${files.length} of ${blobs.length} repository files were retrieved (bounded to ${MAX_FILES} files / ${Math.round(MAX_TOTAL_BYTES / 1000)} KB).`,
            "Only the default branch was inspected. Dependency installations, builds and tests are never executed.",
            "Findings describe documentation and configuration evidence, not code quality or security vulnerabilities.",
            ...warnings,
        ],
    });
    return { snapshot, accessMode, warnings };
}

const ECOSYSTEM_LABELS = {
    node: "JavaScript / TypeScript",
    python: "Python",
    java: "Java / JVM",
    go: "Go",
    rust: "Rust",
    unknown: "Unrecognized ecosystem",
};
const MANIFEST_RULES = [
    { id: "node", manifests: [/^package\.json$/, /^deno\.jsonc?$/] },
    { id: "python", manifests: [/^pyproject\.toml$/, /^requirements[\w.-]*\.txt$/, /^setup\.py$/, /^Pipfile$/] },
    { id: "java", manifests: [/^pom\.xml$/, /^build\.gradle(\.kts)?$/, /^settings\.gradle(\.kts)?$/] },
    { id: "go", manifests: [/^go\.mod$/] },
    { id: "rust", manifests: [/^Cargo\.toml$/] },
];
export function detectEcosystem(paths, primaryLanguage) {
    const rootPaths = paths.filter((path) => !path.includes("/"));
    for (const rule of MANIFEST_RULES) {
        const manifests = rootPaths.filter((path) => rule.manifests.some((pattern) => pattern.test(path)));
        if (manifests.length > 0) {
            return {
                id: rule.id,
                label: ECOSYSTEM_LABELS[rule.id],
                manifests: manifests.sort(),
                evidence: manifests.map((manifest) => `Root manifest detected: ${manifest}`),
                primaryLanguage,
            };
        }
    }
    return {
        id: "unknown",
        label: ECOSYSTEM_LABELS.unknown,
        manifests: [],
        evidence: rootPaths.length > 0
            ? ["No supported manifest was found at the repository root."]
            : ["No repository files were readable, so no ecosystem could be detected."],
        primaryLanguage,
    };
}
export function buildSnapshot(input) {
    const maxFileBytes = input.maxFileBytes ?? 200_000;
    const files = [];
    const limitations = [...input.analysisLimitations];
    const seen = new Set();
    for (const file of input.files) {
        const path = file.path.replace(/^\/+/, "");
        if (!path || path.includes("..") || path.startsWith(".git/") || seen.has(path))
            continue;
        seen.add(path);
        const bytes = Buffer.byteLength(file.content, "utf8");
        const truncated = bytes > maxFileBytes;
        files.push({
            path,
            content: truncated ? file.content.slice(0, maxFileBytes) : file.content,
            bytes,
            truncated,
        });
        if (truncated)
            limitations.push(`File ${path} was truncated to ${maxFileBytes} bytes for analysis.`);
    }
    const tree = Array.from(new Set([...(input.tree ?? []), ...files.map((file) => file.path)])).sort();
    const ecosystem = detectEcosystem(tree, input.repository.primaryLanguage);
    if (ecosystem.id === "unknown") {
        limitations.push("The ecosystem could not be detected from repository files. Ecosystem-specific checks were treated as not applicable.");
    }
    return {
        repository: input.repository,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
        tree,
        ecosystem,
        mode: input.mode,
        fetchedAt: input.fetchedAt,
        analysisLimitations: Array.from(new Set(limitations)),
    };
}
export function snapshotPaths(snapshot) {
    return snapshot.tree;
}
/** Case-insensitive root fallback lookup used for README/LICENSE style files. */
export function findSnapshotFile(snapshot, matcher) {
    return snapshot.files.find((file) => matcher.test(file.path));
}

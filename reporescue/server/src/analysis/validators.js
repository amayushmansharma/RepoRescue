import { parse as parseYaml } from "yaml";
import { countFencedBlocks, markdownHeadings } from "./text.js";
export const MAX_PATCH_BYTES = 120_000;
/** Rejects traversal, absolute paths, NUL bytes and anything outside the repo. */
export function isSafeRepositoryPath(path) {
    if (!path || path.length > 200)
        return false;
    if (path.includes("\u0000") || path.includes("\\"))
        return false;
    if (path.startsWith("/") || path.startsWith("~"))
        return false;
    if (path.includes(".."))
        return false;
    const segments = path.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".."))
        return false;
    if (segments[0] === ".git")
        return false;
    return /^[\w.@()/ -]+$/.test(path);
}
export function validateJson(content) {
    try {
        JSON.parse(content);
        return { id: "json-syntax", label: "JSON syntax", state: "passed", detail: "Content parsed with JSON.parse." };
    }
    catch (error) {
        return {
            id: "json-syntax",
            label: "JSON syntax",
            state: "failed",
            detail: error instanceof Error ? error.message.slice(0, 200) : "JSON.parse failed.",
        };
    }
}
export function validateYaml(content) {
    try {
        const parsed = parseYaml(content);
        if (parsed === null || typeof parsed !== "object") {
            return { id: "yaml-syntax", label: "YAML syntax", state: "failed", detail: "YAML parsed but did not produce a mapping." };
        }
        return { id: "yaml-syntax", label: "YAML syntax", state: "passed", detail: "Content parsed with the yaml parser." };
    }
    catch (error) {
        return {
            id: "yaml-syntax",
            label: "YAML syntax",
            state: "failed",
            detail: error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "YAML parse failed.",
        };
    }
}
export function validateMarkdown(content) {
    const checks = [];
    const fenceLines = content.split("\n").filter((line) => /^\s*(```|~~~)/.test(line)).length;
    checks.push({
        id: "markdown-structure",
        label: "Markdown structure",
        state: fenceLines % 2 === 0 ? "passed" : "failed",
        detail: fenceLines % 2 === 0 ? `${countFencedBlocks(content)} fenced code block(s), all closed.` : "Unbalanced code fences detected.",
    });
    const headings = markdownHeadings(content);
    checks.push({
        id: "markdown-headings",
        label: "Document headings",
        state: headings.length > 0 ? "passed" : "failed",
        detail: headings.length > 0 ? `${headings.length} heading(s); first heading: "${headings[0].text}".` : "No markdown headings found.",
    });
    return checks;
}
export function validateWorkflowStructure(content) {
    const hasTriggers = /^on:|^"on":|^\s{2}on:/m.test(content);
    const hasJobs = /^jobs:/m.test(content);
    const hasSteps = /steps:/.test(content);
    return {
        id: "workflow-structure",
        label: "Workflow structure",
        state: hasTriggers && hasJobs && hasSteps ? "passed" : "failed",
        detail: hasTriggers && hasJobs && hasSteps
            ? "Workflow declares triggers, jobs and steps."
            : "Workflow is missing one of: triggers (on), jobs, steps.",
    };
}
export function validateFileContent(path, content) {
    const checks = [];
    if (Buffer.byteLength(content, "utf8") > MAX_PATCH_BYTES) {
        checks.push({
            id: "size-limit",
            label: "File size limit",
            state: "failed",
            detail: `Proposed file is larger than ${MAX_PATCH_BYTES} bytes.`,
        });
        return checks;
    }
    if (/\.json$/i.test(path))
        checks.push(validateJson(content));
    if (/\.ya?ml$/i.test(path)) {
        checks.push(validateYaml(content));
        if (/^\.github\/workflows\//i.test(path))
            checks.push(validateWorkflowStructure(content));
    }
    if (/\.md$/i.test(path))
        checks.push(...validateMarkdown(content));
    if (/^\.env/.test(path) || path.endsWith(".env.example")) {
        const duplicateKeys = findDuplicateEnvKeys(content);
        checks.push({
            id: "env-template",
            label: "Environment template format",
            state: duplicateKeys.length === 0 ? "passed" : "failed",
            detail: duplicateKeys.length === 0 ? "Every line is a KEY=value entry or comment." : `Duplicate or malformed keys: ${duplicateKeys.join(", ")}.`,
        });
    }
    if (/^\.gitignore$/.test(path)) {
        checks.push({
            id: "gitignore-patterns",
            label: "Ignore patterns",
            state: content.includes(".env") ? "passed" : "failed",
            detail: content.includes(".env") ? "Ignore patterns include local environment files." : "Generated ignore file does not exclude .env files.",
        });
    }
    if (checks.length === 0) {
        checks.push({
            id: "no-validator",
            label: "Syntax validation",
            state: "skipped",
            detail: "No automated validator is available for this file type.",
        });
    }
    return checks;
}
function findDuplicateEnvKeys(content) {
    const keys = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split("=")[0]);
    const seen = new Set();
    const duplicates = [];
    for (const key of keys) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
            duplicates.push(key || "<empty>");
            continue;
        }
        if (seen.has(key))
            duplicates.push(key);
        seen.add(key);
    }
    return duplicates;
}
export function summariseValidation(checks) {
    if (checks.some((check) => check.state === "failed"))
        return "failed";
    const meaningful = checks.filter((check) => check.state !== "skipped" && check.state !== "unavailable");
    if (meaningful.length === 0)
        return "skipped";
    if (checks.some((check) => check.state === "unavailable"))
        return "unavailable";
    return "passed";
}

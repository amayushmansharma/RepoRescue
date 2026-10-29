/** Small, dependency-free text helpers used by analysis and remediation. */
export function lineNumberOf(content, needle, fromLine = 1) {
    const lines = content.split("\n");
    for (let index = Math.max(0, fromLine - 1); index < lines.length; index += 1) {
        const line = lines[index];
        const matched = typeof needle === "string" ? line.includes(needle) : needle.test(line);
        if (matched)
            return index + 1;
    }
    return null;
}
export function excerptAround(content, line, context = 1) {
    const lines = content.split("\n");
    const start = Math.max(0, line - 1 - context);
    const end = Math.min(lines.length, line + context);
    return lines.slice(start, end).join("\n");
}
export function markdownHeadings(content) {
    const headings = [];
    let inFence = false;
    content.split("\n").forEach((line, index) => {
        if (/^\s*(```|~~~)/.test(line))
            inFence = !inFence;
        if (inFence)
            return;
        const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
        if (match) {
            headings.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
        }
    });
    return headings;
}
export function findHeading(content, patterns) {
    const headings = markdownHeadings(content);
    for (const heading of headings) {
        if (patterns.some((pattern) => pattern.test(heading.text)))
            return heading;
    }
    return null;
}
/** Returns markdown section body (without the heading line) and its line range. */
export function markdownSection(content, heading) {
    const lines = content.split("\n");
    const startIndex = heading.line; // 0-based index of the line after the heading
    let endIndex = lines.length;
    for (let index = startIndex; index < lines.length; index += 1) {
        const next = /^(#{1,6})\s+/.exec(lines[index]);
        if (next && next[1].length <= heading.level) {
            endIndex = index;
            break;
        }
    }
    return {
        body: lines.slice(startIndex, endIndex).join("\n").trim(),
        startLine: heading.line,
        endLine: endIndex,
    };
}
export function countFencedBlocks(content) {
    const fences = content.split("\n").filter((line) => /^\s*(```|~~~)/.test(line));
    return Math.floor(fences.length / 2);
}
export function extractEnvKeys(content) {
    const keys = new Set();
    const patterns = [
        /process\.env\.([A-Z][A-Z0-9_]*)/g,
        /process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g,
        /os\.environ\[["']([A-Z][A-Z0-9_]*)["']\]/g,
        /os\.environ\.get\(["']([A-Z][A-Z0-9_]*)["']/g,
        /os\.getenv\(["']([A-Z][A-Z0-9_]*)["']/g,
        /getenv\(["']([A-Z][A-Z0-9_]*)["']\)/g,
        /ENV\[["']([A-Z][A-Z0-9_]*)["']\]/g,
    ];
    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
            const key = match[1];
            if (key && key.length <= 64 && !["NODE_ENV", "CI"].includes(key))
                keys.add(key);
        }
    }
    return Array.from(keys).sort();
}
export function envTemplateKeys(content) {
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.replace(/^export\s+/, "").split("=")[0].trim())
        .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key));
}
export function hasAnyCommand(content, pattern) {
    return pattern.test(content);
}
export function normalizeNewlines(value) {
    return value.replace(/\r\n/g, "\n");
}

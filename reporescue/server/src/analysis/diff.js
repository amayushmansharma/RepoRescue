/**
 * Deterministic unified diff generator.
 *
 * Small enough to audit, shared by the remediation preview and the review
 * screen so a diff can never disagree with the patch it describes.
 */
const MAX_LCS_LINES = 1200;
const CONTEXT = 3;
function splitLines(content) {
    return content.replace(/\r\n/g, "\n").split("\n");
}
function buildOps(originalLines, proposedLines) {
    const n = originalLines.length;
    const m = proposedLines.length;
    if (n * m > MAX_LCS_LINES * MAX_LCS_LINES) {
        // Defensive bound: fall back to a coarse replacement rather than hanging.
        return [
            ...originalLines.map((line) => ({ type: "remove", line })),
            ...proposedLines.map((line) => ({ type: "add", line })),
        ];
    }
    const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            table[i][j] =
                originalLines[i] === proposedLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (originalLines[i] === proposedLines[j]) {
            ops.push({ type: "equal", line: originalLines[i] });
            i += 1;
            j += 1;
        }
        else if (table[i + 1][j] >= table[i][j + 1]) {
            ops.push({ type: "remove", line: originalLines[i] });
            i += 1;
        }
        else {
            ops.push({ type: "add", line: proposedLines[j] });
            j += 1;
        }
    }
    while (i < n) {
        ops.push({ type: "remove", line: originalLines[i] });
        i += 1;
    }
    while (j < m) {
        ops.push({ type: "add", line: proposedLines[j] });
        j += 1;
    }
    return ops;
}
export function unifiedDiff(path, original, proposed) {
    const proposedLines = splitLines(proposed);
    if (original === null) {
        const header = [`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${proposedLines.length} @@`];
        const body = proposedLines.map((line) => `+${line}`);
        return {
            diff: [...header, ...body].join("\n"),
            additions: proposedLines.length,
            deletions: 0,
        };
    }
    const originalLines = splitLines(original);
    const ops = buildOps(originalLines, proposedLines);
    if (ops.every((op) => op.type === "equal")) {
        return { diff: "", additions: 0, deletions: 0 };
    }
    const hunks = [];
    let oldLine = 1;
    let newLine = 1;
    let current = null;
    let pendingContext = [];
    let unchangedRun = 0;
    const closeHunk = () => {
        if (current)
            hunks.push(current);
        current = null;
        pendingContext = [];
        unchangedRun = 0;
    };
    for (const op of ops) {
        if (op.type === "equal") {
            unchangedRun += 1;
            if (current) {
                if (unchangedRun <= CONTEXT * 2) {
                    current.lines.push(` ${op.line}`);
                    current.oldCount += 1;
                    current.newCount += 1;
                }
                else {
                    closeHunk();
                }
            }
            else {
                pendingContext.push({ line: op.line, oldLine, newLine });
                if (pendingContext.length > CONTEXT)
                    pendingContext.shift();
            }
            oldLine += 1;
            newLine += 1;
            continue;
        }
        if (!current) {
            const contextStart = pendingContext.length > 0 ? pendingContext[0] : { line: "", oldLine, newLine };
            current = {
                oldStart: pendingContext.length > 0 ? contextStart.oldLine : oldLine,
                oldCount: 0,
                newStart: pendingContext.length > 0 ? contextStart.newLine : newLine,
                newCount: 0,
                lines: pendingContext.map((entry) => ` ${entry.line}`),
            };
            current.oldCount += pendingContext.length;
            current.newCount += pendingContext.length;
            pendingContext = [];
        }
        unchangedRun = 0;
        if (op.type === "remove") {
            current.lines.push(`-${op.line}`);
            current.oldCount += 1;
            oldLine += 1;
        }
        else {
            current.lines.push(`+${op.line}`);
            current.newCount += 1;
            newLine += 1;
        }
    }
    closeHunk();
    const header = [`--- a/${path}`, `+++ b/${path}`];
    const hunkText = hunks.map((hunk) => {
        const oldStart = hunk.oldCount === 0 ? Math.max(0, hunk.oldStart - 1) : hunk.oldStart;
        const newStart = hunk.newCount === 0 ? Math.max(0, hunk.newStart - 1) : hunk.newStart;
        return [`@@ -${oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@`, ...hunk.lines].join("\n");
    });
    const diff = [header.join("\n"), ...hunkText].join("\n");
    const additions = ops.filter((op) => op.type === "add").length;
    const deletions = ops.filter((op) => op.type === "remove").length;
    return { diff, additions, deletions };
}
/** Parses a unified diff body back to proposed content for consistency tests. */
export function parseUnifiedDiff(diff) {
    const files = {};
    let current = null;
    for (const line of diff.split("\n")) {
        const headerMatch = /^\+\+\+ b\/(.+)$/.exec(line);
        if (headerMatch) {
            current = [];
            files[headerMatch[1]] = current;
            continue;
        }
        if (!current)
            continue;
        if (line.startsWith("@@"))
            continue;
        if (line.startsWith("+++") || line.startsWith("---"))
            continue;
        if (line.startsWith("+"))
            current.push(line.slice(1));
        else if (line.startsWith(" "))
            current.push(line.slice(1));
    }
    delete files["/dev/null"];
    return files;
}

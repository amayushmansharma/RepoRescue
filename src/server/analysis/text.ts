/** Small, dependency-free text helpers used by analysis and remediation. */

export function lineNumberOf(content: string, needle: string | RegExp, fromLine = 1): number | null {
  const lines = content.split("\n");
  for (let index = Math.max(0, fromLine - 1); index < lines.length; index += 1) {
    const line = lines[index];
    const matched = typeof needle === "string" ? line.includes(needle) : needle.test(line);
    if (matched) return index + 1;
  }
  return null;
}

export function excerptAround(content: string, line: number, context = 1): string {
  const lines = content.split("\n");
  const start = Math.max(0, line - 1 - context);
  const end = Math.min(lines.length, line + context);
  return lines.slice(start, end).join("\n");
}

export type MarkdownHeading = { level: number; text: string; line: number };

export function markdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let inFence = false;
  content.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
    }
  });
  return headings;
}

export function findHeading(content: string, patterns: RegExp[]): MarkdownHeading | null {
  const headings = markdownHeadings(content);
  for (const heading of headings) {
    if (patterns.some((pattern) => pattern.test(heading.text))) return heading;
  }
  return null;
}

/** Returns markdown section body (without the heading line) and its line range. */
export function markdownSection(
  content: string,
  heading: MarkdownHeading,
): { body: string; startLine: number; endLine: number } {
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

export function countFencedBlocks(content: string): number {
  const fences = content.split("\n").filter((line) => /^\s*(```|~~~)/.test(line));
  return Math.floor(fences.length / 2);
}

export function extractEnvKeys(content: string): string[] {
  const keys = new Set<string>();
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
      if (key && key.length <= 64 && !["NODE_ENV", "CI"].includes(key)) keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

export function envTemplateKeys(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^export\s+/, "").split("=")[0].trim())
    .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key));
}

export function hasAnyCommand(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

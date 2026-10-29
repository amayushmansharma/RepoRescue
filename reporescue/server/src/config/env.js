import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader (no dependency): KEY=value lines, '#' comments, no interpolation. */
export function loadDotEnv(file = path.resolve(here, "../../../.env")) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** Validates runtime configuration and explains problems without echoing secrets. */
export function loadConfig() {
  loadDotEnv();
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535 (received "${process.env.PORT}").`);
  }
  const token = process.env.GITHUB_TOKEN?.trim() || "";
  if (token && token.length < 20) {
    console.warn("[reporescue] GITHUB_TOKEN looks malformed (too short); live scans will run anonymously if GitHub rejects it.");
  }
  return {
    port,
    host: process.env.HOST ?? "0.0.0.0",
    clientOrigin: process.env.CLIENT_ORIGIN ?? "",
    trustProxy: process.env.TRUST_PROXY === "true",
    githubToken: token,
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

/**
 * Repository identifier normalization.
 *
 * Accepts the formats people actually paste:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo/tree/main/subdir
 *   - git@github.com:owner/repo.git
 *   - github.com/owner/repo
 *   - owner/repo
 *
 * Rejects anything else (other hosts, paths with traversal, malformed names)
 * with a typed error so route handlers can answer with 400 + a useful code.
 */

export class InvalidRepositoryError extends Error {
  code: string;
  constructor(message: string, code = "INVALID_REPOSITORY") {
    super(message);
    this.name = "InvalidRepositoryError";
    this.code = code;
  }
}

export type NormalizedRepository = {
  owner: string;
  name: string;
  fullName: string;
  url: string;
};

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const RESERVED = new Set([".", ".."]);

export const MAX_REPOSITORY_INPUT = 300;

export function normalizeRepositoryInput(raw: string): NormalizedRepository {
  if (typeof raw !== "string") {
    throw new InvalidRepositoryError("Repository input must be a string.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidRepositoryError("Enter a repository URL or owner/repository.");
  }
  if (trimmed.length > MAX_REPOSITORY_INPUT) {
    throw new InvalidRepositoryError("Repository input is too long.");
  }
  if (/[\s\u0000-\u001f]/.test(trimmed)) {
    throw new InvalidRepositoryError("Repository input must not contain whitespace or control characters.");
  }

  let path = trimmed;
  if (path.startsWith("git@")) {
    const ssh = /^git@github\.com:([^/]+)\/(.+)$/.exec(path);
    if (!ssh) throw new InvalidRepositoryError("Only github.com SSH remotes are supported.");
    path = `${ssh[1]}/${ssh[2]}`;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      throw new InvalidRepositoryError("That URL could not be parsed.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new InvalidRepositoryError("Only https:// github.com URLs are supported.");
    }
    if (url.hostname.toLowerCase() !== "github.com" && url.hostname.toLowerCase() !== "www.github.com") {
      throw new InvalidRepositoryError("Only github.com repositories are supported.");
    }
    path = url.pathname.replace(/^\/+/, "");
  } else if (/^(www\.)?github\.com\//i.test(path)) {
    path = path.replace(/^(www\.)?github\.com\//i, "");
  }

  path = path.split("?")[0].split("#")[0];
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    throw new InvalidRepositoryError("Expected owner/repository, for example octocat/hello-world.");
  }
  if (segments.length > 2) {
    // Allow /tree/<branch>/... style links but nothing deeper than the repo root.
    const allowed = segments[2] === "tree" || segments[2] === "blob";
    if (!allowed) {
      throw new InvalidRepositoryError("Only repository root URLs are supported.");
    }
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  if (RESERVED.has(owner) || RESERVED.has(name) || name === ".git") {
    throw new InvalidRepositoryError("Invalid repository path.");
  }
  if (owner.includes("..") || name.includes("..")) {
    throw new InvalidRepositoryError("Repository path traversal is not allowed.");
  }
  if (!OWNER_PATTERN.test(owner)) {
    throw new InvalidRepositoryError("The owner name is not a valid GitHub login.");
  }
  if (!NAME_PATTERN.test(name)) {
    throw new InvalidRepositoryError("The repository name contains unsupported characters.");
  }

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

export function isValidRepositoryInput(raw: string): boolean {
  try {
    normalizeRepositoryInput(raw);
    return true;
  } catch {
    return false;
  }
}

/** Deterministic slug used for generated branch names. */
export function slugify(value: string, maxLength = 48): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength) || "update";
}

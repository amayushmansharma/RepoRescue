import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidRepositoryError, normalizeRepositoryInput, slugify } from "../src/server/analysis/normalize";
import { isSafeRepositoryPath } from "../src/server/analysis/validators";

test("normalizes accepted repository input formats", () => {
  const cases = [
    "https://github.com/octocat/hello-world",
    "https://github.com/octocat/hello-world.git",
    "https://github.com/octocat/hello-world/",
    "http://github.com/octocat/hello-world",
    "https://github.com/octocat/hello-world/tree/main/src",
    "git@github.com:octocat/hello-world.git",
    "github.com/octocat/hello-world",
    "  octocat/hello-world  ",
    "octocat/hello-world?tab=readme",
  ];
  for (const input of cases) {
    const normalized = normalizeRepositoryInput(input);
    assert.equal(normalized.fullName, "octocat/hello-world", input);
    assert.equal(normalized.owner, "octocat");
    assert.equal(normalized.name, "hello-world");
    assert.equal(normalized.url, "https://github.com/octocat/hello-world");
  }
});

test("rejects malformed, unsupported and unsafe repository input", () => {
  const invalid = [
    "",
    "   ",
    "owner-only",
    "https://gitlab.com/owner/repo",
    "https://github.com/owner/repo/issues/1",
    "https://github.com/owner/../../etc",
    "../owner/repo",
    "owner/repo/extra/path",
    "-badowner/repo",
    "owner/re po",
    "ftp://github.com/owner/repo",
  ];
  for (const input of invalid) {
    assert.throws(() => normalizeRepositoryInput(input), InvalidRepositoryError, input);
  }
});

test("overlong repository input is rejected with a typed error", () => {
  assert.throws(() => normalizeRepositoryInput(`owner/${"a".repeat(400)}`), (error: unknown) => {
    return error instanceof InvalidRepositoryError && error.code === "INVALID_REPOSITORY";
  });
});

test("slugify produces deterministic branch-safe slugs", () => {
  assert.equal(slugify("Improve Contributor Onboarding!"), "improve-contributor-onboarding");
  assert.equal(slugify("***"), "update");
});

test("repository paths are checked for traversal and absolutes", () => {
  assert.equal(isSafeRepositoryPath("README.md"), true);
  assert.equal(isSafeRepositoryPath(".github/workflows/ci.yml"), true);
  assert.equal(isSafeRepositoryPath("../secrets.txt"), false);
  assert.equal(isSafeRepositoryPath("/etc/passwd"), false);
  assert.equal(isSafeRepositoryPath("docs/../../x"), false);
  assert.equal(isSafeRepositoryPath("a\\b"), false);
  assert.equal(isSafeRepositoryPath(""), false);
});

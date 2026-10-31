import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiAvailable } from "../../server/src/ai/gemini.js";
import { explainFinding } from "../../server/src/ai/explain-finding.js";

test("geminiAvailable reports false when GEMINI_API_KEY is absent or empty", () => {
  const previous = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    assert.equal(geminiAvailable(), false);

    process.env.GEMINI_API_KEY = "   ";
    assert.equal(geminiAvailable(), false);

    process.env.GEMINI_API_KEY = "short";
    assert.equal(geminiAvailable(), false);
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("explainFinding falls back to evidence-grounded deterministic explanation without API key", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const mockFinding = {
      id: "env-template-missing",
      ruleId: "env-template-missing",
      title: "Configuration variables are required but undocumented",
      category: "setup",
      dimension: "setup",
      severity: "high",
      summary: "The code reads 2 environment variables but no .env.example template exists.",
      whyItMatters: "Undocumented variables cause startup crashes for newcomers.",
      evidence: [
        { label: "Environment read: DATABASE_URL", path: "src/db.js", startLine: 10, excerpt: "process.env.DATABASE_URL" },
      ],
      recommendation: "Add a committed .env.example with placeholder values.",
      remediation: {
        kind: "auto",
        steps: [
          "Create .env.example with placeholders.",
          "Document required variables in README.",
        ],
      },
      confidence: "confirmed",
      effort: "small",
      beginnerSuitable: true,
    };

    const result = await explainFinding({
      finding: mockFinding,
      repositoryName: "acme/widget",
    });

    assert.equal(result.source, "deterministic");
    assert.equal(result.model, null);
    assert.equal(result.rateLimited, false);
    assert.ok(result.text.includes("**What was found**"));
    assert.ok(result.text.includes("**Why it matters**"));
    assert.ok(result.text.includes("**Who is affected**"));
    assert.ok(result.text.includes("**What to do next**"));
    assert.ok(result.text.includes("**Difficulty and impact**"));
    assert.ok(result.text.includes("new contributors"));
    assert.ok(result.text.includes("DATABASE_URL") || result.text.includes("undocumented"));
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("explainFinding correctly flags maintainer-oriented findings in fallback", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const mockFinding = {
      id: "license-missing",
      ruleId: "license-missing",
      title: "No LICENSE file at root",
      category: "hygiene",
      dimension: "hygiene",
      severity: "high",
      summary: "No license file was detected at root.",
      whyItMatters: "Without a license, default copyright laws apply.",
      evidence: [],
      recommendation: "Choose an open-source license and commit a LICENSE file.",
      remediation: { kind: "manual" },
      confidence: "confirmed",
      effort: "medium",
      beginnerSuitable: false,
    };

    const result = await explainFinding({
      finding: mockFinding,
      repositoryName: "acme/widget",
    });

    assert.equal(result.source, "deterministic");
    assert.ok(result.text.includes("maintainers and experienced contributors"));
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
    else delete process.env.GEMINI_API_KEY;
  }
});

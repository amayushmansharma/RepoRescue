import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOpportunities } from "../../server/src/analysis/opportunities.js";

const mockRepository = {
  fullName: "test-owner/test-repo",
  name: "test-repo",
  owner: "test-owner",
};

test("deriveOpportunities produces structured, prioritized opportunities from findings", () => {
  const findings = [
    {
      id: "env-template-missing",
      ruleId: "env-template-missing",
      title: "Configuration variables are required but undocumented",
      category: "setup",
      dimension: "setup",
      severity: "high",
      summary: "The code reads 2 environment variables but no .env.example template exists.",
      whyItMatters: "Undocumented variables cause startup crashes for newcomers.",
      evidence: [
        { label: "Environment read: DATABASE_URL", path: "src/db.js", startLine: 10 },
      ],
      location: { path: "src/db.js", startLine: 10 },
      recommendation: "Add a committed .env.example with placeholder values.",
      remediation: {
        kind: "auto",
        steps: ["Create .env.example with placeholders."],
      },
      confidence: "confirmed",
      effort: "small",
      beginnerSuitable: true,
      validationMethod: "Template check",
    },
    {
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
      validationMethod: "File listing",
    },
  ];

  const opportunities = deriveOpportunities(findings, mockRepository);

  assert.equal(opportunities.length, 2);

  // Highest priority (beginner-friendly + auto-fixable + high severity) must be first
  const first = opportunities[0];
  assert.equal(first.sourceFindingId, "env-template-missing");
  assert.equal(first.title, "Create committed .env.example configuration template");
  assert.equal(first.source, "scanner-finding");
  assert.equal(first.sourceType, "deterministic-rule");
  assert.equal(first.difficulty, "easy");
  assert.equal(first.beginnerSuitable, true);
  assert.equal(first.fixable, true);
  assert.equal(first.priority, "high");
  assert.ok(first.priorityScore >= 70);
  assert.ok(first.relevantFiles.includes("src/db.js"));
  assert.ok(first.impact.includes("setup"));

  const second = opportunities[1];
  assert.equal(second.sourceFindingId, "license-missing");
  assert.equal(second.beginnerSuitable, false);
  assert.equal(second.fixable, false);
  assert.equal(second.difficulty, "medium");
});

test("deriveOpportunities handles empty findings gracefully", () => {
  const result = deriveOpportunities([], mockRepository);
  assert.deepEqual(result, []);

  const nullResult = deriveOpportunities(null, mockRepository);
  assert.deepEqual(nullResult, []);
});

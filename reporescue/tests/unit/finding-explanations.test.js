import assert from "node:assert/strict";
import test from "node:test";
import { FINDING_SIMPLE_EXPLANATIONS, getSimpleExplanation } from "../../client/src/data/finding-explanations.js";

test("finding explanations mapping covers all 21 core rules", () => {
  const expectedRuleIds = [
    "readme-missing",
    "readme-install-missing",
    "readme-prerequisites-missing",
    "readme-usage-missing",
    "manifest-missing",
    "lockfile-missing",
    "env-template-missing",
    "env-template-incomplete",
    "tests-missing",
    "test-command-undocumented",
    "ci-missing",
    "ci-tests-missing",
    "contributing-missing",
    "code-of-conduct-missing",
    "templates-missing",
    "contribution-workflow-undocumented",
    "license-missing",
    "manifest-license-missing",
    "gitignore-missing",
    "metadata-incomplete",
    "committed-env-file",
  ];

  assert.equal(Object.keys(FINDING_SIMPLE_EXPLANATIONS).length, 21);

  for (const ruleId of expectedRuleIds) {
    const explanation = getSimpleExplanation(ruleId);
    assert.ok(explanation, `Expected explanation for ruleId: ${ruleId}`);
    assert.ok(typeof explanation.meaning === "string" && explanation.meaning.length > 10);
    assert.ok(typeof explanation.whyItMatters === "string" && explanation.whyItMatters.length > 10);
  }
});

test("getSimpleExplanation handles unknown and invalid rule IDs gracefully", () => {
  assert.equal(getSimpleExplanation("unknown-rule-xyz"), null);
  assert.equal(getSimpleExplanation(""), null);
  assert.equal(getSimpleExplanation(null), null);
  assert.equal(getSimpleExplanation(undefined), null);
  assert.equal(getSimpleExplanation(123), null);
});

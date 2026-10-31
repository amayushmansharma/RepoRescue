/**
 * Contribution Opportunity Engine.
 *
 * Transforms raw repository health findings into prioritized, actionable
 * contribution opportunities for developers.
 *
 * Principles:
 *  - Grounded strictly in scanner findings; no fabricated tasks.
 *  - Clear source attribution: every opportunity links to its parent finding.
 *  - Distinguishes scanner-derived opportunities from official GitHub issues.
 *  - Prioritizes beginner-friendly, high-impact, actionable tasks.
 */

const ACTION_TITLES = {
  "readme-missing": "Author foundational README documentation",
  "readme-install-missing": "Document step-by-step installation instructions in README",
  "readme-prerequisites-missing": "Document runtime and tooling prerequisites",
  "readme-usage-missing": "Add project run & usage instructions to README",
  "env-template-missing": "Create committed .env.example configuration template",
  "env-template-incomplete": "Document missing environment variables in .env.example",
  "ci-missing": "Set up GitHub Actions CI workflow for pull requests",
  "contributing-missing": "Add CONTRIBUTING.md contributor onboarding guide",
  "code-of-conduct-missing": "Adopt Contributor Covenant CODE_OF_CONDUCT.md",
  "templates-missing": "Add GitHub issue and pull request templates",
  "gitignore-missing": "Add .gitignore tailored to the project ecosystem",
  "test-command-undocumented": "Document test commands in the project README",
  "tests-missing": "Set up test runner and commit initial smoke test",
  "manifest-license-missing": "Declare committed license SPDX identifier in manifest",
  "manifest-missing": "Add build system dependency manifest",
  "lockfile-missing": "Generate and commit dependency lockfile",
  "committed-env": "Remove sensitive committed environment file and ignore it",
  "license-missing": "Choose and commit an open-source LICENSE file",
};

const DIFFICULTY_MAP = {
  small: { label: "easy", description: "Good first issue — can be completed in under 1 hour" },
  medium: { label: "medium", description: "Moderate scope — typically 1 to 3 hours" },
  large: { label: "involved", description: "Substantial effort — requires maintainer consultation" },
};

const SEVERITY_POINTS = {
  critical: 40,
  high: 35,
  medium: 22,
  low: 12,
  info: 5,
};

/**
 * Computes a contributor priority score (0–100) for a finding.
 * Gives strong weight to beginner suitability and safe fixability so that
 * newcomers get actionable, achievable tasks at the top of their list.
 */
function computeOpportunityPriority(finding) {
  let score = SEVERITY_POINTS[finding.severity] ?? 15;
  if (finding.beginnerSuitable) score += 25;
  if (finding.remediation?.kind === "auto") score += 20;
  if (finding.confidence === "confirmed") score += 15;
  return Math.min(100, score);
}

function priorityTier(score) {
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function describeImpact(finding) {
  const dimension = finding.dimension ?? "health";
  const dimensionNames = {
    documentation: "documentation clarity",
    setup: "developer onboarding and setup",
    testing: "testing confidence and CI reliability",
    contribution: "community contribution readiness",
    hygiene: "repository hygiene and legal clarity",
  };
  const focus = dimensionNames[dimension] ?? `${dimension} readiness`;

  if (finding.remediation?.kind === "auto") {
    return `Immediately resolves the "${finding.title}" gap with a verified patch; directly improves ${focus}.`;
  }
  return `Helps unblock newcomers and maintainers by improving ${focus}.`;
}

/**
 * Derives a list of structured contribution opportunities from an assessment's findings.
 *
 * @param {Array<object>} findings
 * @param {object} repository
 * @returns {Array<object>}
 */
export function deriveOpportunities(findings, repository) {
  if (!Array.isArray(findings)) return [];

  const opportunities = findings.map((finding) => {
    const priorityScore = computeOpportunityPriority(finding);
    const difficultyInfo = DIFFICULTY_MAP[finding.effort] ?? DIFFICULTY_MAP.medium;
    const relevantFiles = Array.from(
      new Set(
        [
          finding.location?.path,
          ...finding.evidence.map((e) => e.path).filter(Boolean),
        ].filter(Boolean),
      ),
    );

    const actionTitle = ACTION_TITLES[finding.ruleId] ?? finding.title;

    return {
      id: `opp-${finding.id}`,
      sourceFindingId: finding.id,
      ruleId: finding.ruleId,
      source: "scanner-finding",
      sourceType: "deterministic-rule",
      title: actionTitle,
      originalFindingTitle: finding.title,
      category: finding.category,
      dimension: finding.dimension,
      severity: finding.severity,
      priority: priorityTier(priorityScore),
      priorityScore,
      difficulty: difficultyInfo.label,
      difficultyDescription: difficultyInfo.description,
      effort: finding.effort,
      beginnerSuitable: Boolean(finding.beginnerSuitable),
      fixable: finding.remediation?.kind === "auto",
      remediationKind: finding.remediation?.kind ?? "manual",
      summary: finding.summary,
      whyItMatters: finding.whyItMatters,
      suggestedAction: finding.recommendation,
      steps: finding.remediation?.steps ?? [finding.recommendation],
      impact: describeImpact(finding),
      relevantFiles,
      evidenceSummary: finding.evidence.slice(0, 3).map((e) => ({
        label: e.label,
        path: e.path ?? null,
        note: e.note ?? null,
      })),
      repositoryFullName: repository?.fullName ?? "unknown",
      validationMethod: finding.validationMethod,
      confidence: finding.confidence,
    };
  });

  // Sort by priorityScore desc, then beginnerSuitable first, then title
  return opportunities.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    if (b.beginnerSuitable !== a.beginnerSuitable) {
      return b.beginnerSuitable ? 1 : -1;
    }
    return a.title.localeCompare(b.title);
  });
}

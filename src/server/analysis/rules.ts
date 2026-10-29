import type {
  CheckEvaluation,
  CheckStatus,
  Confidence,
  DimensionId,
  Evidence,
  Finding,
  FindingCategory,
  RepositorySnapshot,
  Severity,
} from "@/lib/types";
import { excerptAround, extractEnvKeys, envTemplateKeys, findHeading, lineNumberOf, markdownSection } from "./text";

export type AnalysisResult = { checks: CheckEvaluation[]; findings: Finding[] };

type FindingDraft = {
  ruleId: string;
  title: string;
  category: FindingCategory;
  dimension: DimensionId;
  severity: Severity;
  summary: string;
  whyItMatters: string;
  evidence: Evidence[];
  location?: { path: string; startLine?: number; endLine?: number };
  recommendation: string;
  remediation: Finding["remediation"];
  confidence: Confidence;
  validationMethod: string;
  effort: Finding["effort"];
  beginnerSuitable: boolean;
};

const README_PATTERN = /^readme(\.(md|markdown|rst|txt))?$/i;
const CONTRIBUTING_PATTERN = /^(docs\/)?contributing(\.(md|rst|txt))?$/i;
const CONDUCT_PATTERN = /^(docs\/|\.github\/)?code[-_]of[-_]conduct(\.(md|txt))?$/i;
const LICENSE_PATTERN = /^(license|licence|copying)(\.(md|txt|rst))?$/i;
const CI_PATTERN = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const ENV_TEMPLATE_PATTERN = /^(\.?env(\.example|\.sample|\.template|\.dist))$/i;
const LOCKFILES: Record<string, RegExp> = {
  node: /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/,
  python: /^(poetry\.lock|Pipfile\.lock|uv\.lock|requirements[^/]*\.txt)$/,
  java: /^(gradle\.lockfile|maven-wrapper\.properties)$/,
  go: /^go\.sum$/,
  rust: /^Cargo\.lock$/,
  unknown: /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum)$/,
};

export type RuleContext = {
  snapshot: RepositorySnapshot;
  readme?: { path: string; content: string };
  contributing?: { path: string; content: string };
  licenseFile?: { path: string; content: string };
  ciWorkflows: { path: string; content: string }[];
  envKeys: { key: string; path: string; line: number }[];
  envTemplate?: { path: string; content: string; keys: string[] };
  packageManager: { command: string; lockfile: string | null };
  installCommand: string | null;
  testCommand: string | null;
  runCommand: string | null;
  testsDetected: boolean;
  testEvidence: string[];
  manifestLicense: string | null;
  licenseSpdx: string | null;
  committedEnvFiles: string[];
};

export function findFile(snapshot: RepositorySnapshot, matcher: RegExp) {
  return snapshot.files.find((file) => matcher.test(file.path));
}

export function detectPackageManager(snapshot: RepositorySnapshot): { command: string; lockfile: string | null } {
  const paths = new Set(snapshot.tree);
  if (paths.has("pnpm-lock.yaml")) return { command: "pnpm", lockfile: "pnpm-lock.yaml" };
  if (paths.has("yarn.lock")) return { command: "yarn", lockfile: "yarn.lock" };
  if (paths.has("bun.lockb")) return { command: "bun", lockfile: "bun.lockb" };
  if (paths.has("package-lock.json")) return { command: "npm", lockfile: "package-lock.json" };
  return { command: "npm", lockfile: null };
}

export function detectLicenseSpdx(content: string): string | null {
  if (/MIT License|Permission is hereby granted, free of charge/i.test(content)) return "MIT";
  if (/Apache License\s*,?\s*Version 2\.0/i.test(content)) return "Apache-2.0";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(content) && /Version 3/i.test(content)) return "GPL-3.0";
  if (/BSD 3-Clause/i.test(content)) return "BSD-3-Clause";
  return null;
}

function parsePackageJson(snapshot: RepositorySnapshot): Record<string, unknown> | null {
  const file = snapshot.files.find((entry) => entry.path === "package.json");
  if (!file) return null;
  try {
    const parsed = JSON.parse(file.content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function detectTests(
  snapshot: RepositorySnapshot,
  pkg: Record<string, unknown> | null,
): { testsDetected: boolean; testEvidence: string[] } {
  const evidence: string[] = [];
  const paths = snapshot.tree;
  const ecosystem = snapshot.ecosystem.id;

  if (pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
    if (typeof scripts.test === "string" && !/no test specified/i.test(scripts.test)) {
      evidence.push(`package.json declares a test script: "${scripts.test}"`);
    }
    const devDeps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) } as Record<string, unknown>;
    const runner = ["vitest", "jest", "mocha", "ava", "tap", "uvu"].find((name) => name in devDeps);
    if (runner) evidence.push(`Test runner dependency detected: ${runner}`);
  }
  if (ecosystem === "python") {
    if (paths.includes("pyproject.toml")) {
      const pyproject = snapshot.files.find((file) => file.path === "pyproject.toml")?.content ?? "";
      if (/\[tool\.pytest|pytest/i.test(pyproject)) evidence.push("pyproject.toml configures pytest");
    }
    if (paths.some((path) => /(^|\/)tests?\/.*\.py$/.test(path))) evidence.push("Python test modules found under tests/");
  }
  if (ecosystem === "go" && paths.some((path) => path.endsWith("_test.go"))) evidence.push("Go *_test.go files present");
  if (ecosystem === "rust" && paths.some((path) => path.startsWith("tests/"))) evidence.push("Rust tests/ directory present");
  if (ecosystem === "java") {
    if (paths.some((path) => path.includes("src/test/"))) evidence.push("JUnit test sources present under src/test");
    const pom = snapshot.files.find((file) => file.path === "pom.xml")?.content ?? "";
    if (/surefire|junit/i.test(pom)) evidence.push("pom.xml references a test runner");
  }
  if (paths.some((path) => /\.(test|spec)\.[a-z]+$/i.test(path))) evidence.push("Test files matching *.test/*.spec are committed");

  return { testsDetected: evidence.length > 0, testEvidence: evidence };
}

function buildContext(snapshot: RepositorySnapshot): RuleContext {
  const readme = findFile(snapshot, README_PATTERN);
  const contributing = findFile(snapshot, CONTRIBUTING_PATTERN);
  const licenseFile = findFile(snapshot, LICENSE_PATTERN);
  const ciWorkflows = snapshot.files.filter((file) => CI_PATTERN.test(file.path));
  const envTemplate = findFile(snapshot, ENV_TEMPLATE_PATTERN);
  const pkg = parsePackageJson(snapshot);
  const packageManager = detectPackageManager(snapshot);
  const ecosystem = snapshot.ecosystem.id;

  const envKeys: RuleContext["envKeys"] = [];
  for (const file of snapshot.files) {
    if (/\.(md|txt|rst)$/i.test(file.path) || file.path === ".gitignore") continue;
    for (const key of extractEnvKeys(file.content)) {
      const line = lineNumberOf(file.content, key) ?? 1;
      envKeys.push({ key, path: file.path, line });
    }
  }
  const uniqueEnvKeys = Array.from(new Map(envKeys.map((entry) => [entry.key, entry])).values());

  let installCommand: string | null = null;
  if (ecosystem === "node") {
    installCommand = `${packageManager.command} install`;
  } else if (ecosystem === "python") {
    if (snapshot.tree.includes("poetry.lock")) installCommand = "poetry install";
    else if (snapshot.tree.some((path) => /^requirements[^/]*\.txt$/.test(path))) installCommand = "pip install -r requirements.txt";
    else if (snapshot.tree.includes("pyproject.toml")) installCommand = "pip install -e .";
  } else if (ecosystem === "java") {
    installCommand = snapshot.tree.includes("pom.xml") ? "mvn install" : "./gradlew build";
  } else if (ecosystem === "go") installCommand = "go mod download";
  else if (ecosystem === "rust") installCommand = "cargo build";

  const testCommand = (() => {
    if (ecosystem === "node" && pkg) {
      const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
      if (typeof scripts.test === "string" && !/no test specified/i.test(scripts.test)) {
        return packageManager.command === "npm" ? "npm test" : `${packageManager.command} test`;
      }
    }
    if (ecosystem === "python") return snapshot.tree.includes("poetry.lock") ? "poetry run pytest" : "pytest";
    if (ecosystem === "java") return snapshot.tree.includes("pom.xml") ? "mvn test" : "./gradlew test";
    if (ecosystem === "go") return "go test ./...";
    if (ecosystem === "rust") return "cargo test";
    return null;
  })();

  const runCommand = (() => {
    if (ecosystem === "node" && pkg) {
      const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
      if (typeof scripts.dev === "string") return `${packageManager.command} run dev`;
      if (typeof scripts.start === "string") return `${packageManager.command} start`;
    }
    if (ecosystem === "python") return snapshot.tree.includes("poetry.lock") ? "poetry run python -m tidewatch" : null;
    if (ecosystem === "go") return "go run .";
    if (ecosystem === "rust") return "cargo run";
    if (ecosystem === "java") return snapshot.tree.includes("pom.xml") ? "mvn spring-boot:run" : "./gradlew bootRun";
    return null;
  })();

  const { testsDetected, testEvidence } = detectTests(snapshot, pkg);
  const manifestLicense =
    typeof pkg?.license === "string"
      ? pkg.license
      : snapshot.tree.includes("pyproject.toml")
        ? (/(?:^|\n)license\s*=\s*["']([^"']+)["']/.exec(
            snapshot.files.find((file) => file.path === "pyproject.toml")?.content ?? "",
          )?.[1] ?? null)
        : null;

  const committedEnvFiles = snapshot.tree.filter((path) =>
    /^(\.env(\.local|\.production|\.development|\.test)?|\.env\.local)$/.test(path),
  );

  return {
    snapshot,
    readme: readme ? { path: readme.path, content: readme.content } : undefined,
    contributing: contributing ? { path: contributing.path, content: contributing.content } : undefined,
    licenseFile: licenseFile ? { path: licenseFile.path, content: licenseFile.content } : undefined,
    ciWorkflows: ciWorkflows.map((file) => ({ path: file.path, content: file.content })),
    envKeys: uniqueEnvKeys,
    envTemplate: envTemplate ? { path: envTemplate.path, content: envTemplate.content, keys: envTemplateKeys(envTemplate.content) } : undefined,
    packageManager,
    installCommand,
    testCommand,
    runCommand,
    testsDetected,
    testEvidence,
    manifestLicense,
    licenseSpdx: licenseFile ? detectLicenseSpdx(licenseFile.content) : null,
    committedEnvFiles,
  };
}

export function buildRuleContext(snapshot: RepositorySnapshot): RuleContext {
  return buildContext(snapshot);
}

const INSTALL_PATTERN =
  /(npm (install|ci)|yarn( install)?|pnpm install|bun install|pip install|poetry install|pipenv install|mvn (install|package)|\.\/gradlew|go mod download|cargo build|composer install)/i;
const RUN_PATTERN =
  /(npm run [a-z:-]+|yarn [a-z:-]+|pnpm [a-z:-]+|poetry run|python -m |go run |cargo run|mvn spring-boot:run|uvicorn |flask run|npm start)/i;
const PREREQ_PATTERN =
  /(node(\.js)?\s*(>=|v)?\s*\d+|python\s*3\.\d+|java\s*(>=)?\s*\d+|go\s*1\.\d+|rust\s*1\.\d+|postgres(?:ql)?\s*(?:version\s*)?\d+|jdk\s*\d+)/i;

export function evaluateRepository(snapshot: RepositorySnapshot): AnalysisResult {
  const ctx = buildContext(snapshot);
  const checks: CheckEvaluation[] = [];
  const findings: Finding[] = [];

  const makeFinding = (draft: FindingDraft): Finding => {
    const finding: Finding = {
      id: draft.ruleId,
      ruleId: draft.ruleId,
      title: draft.title,
      category: draft.category,
      dimension: draft.dimension,
      severity: draft.severity,
      summary: draft.summary,
      whyItMatters: draft.whyItMatters,
      evidence: draft.evidence,
      location: draft.location,
      recommendation: draft.recommendation,
      remediation: draft.remediation,
      confidence: draft.confidence,
      validationMethod: draft.validationMethod,
      effort: draft.effort,
      beginnerSuitable: draft.beginnerSuitable,
      status: "open",
    };
    findings.push(finding);
    return finding;
  };

  const record = (input: {
    id: string;
    dimension: DimensionId;
    label: string;
    weight: number;
    status: CheckStatus;
    evidence: string;
    findingIds?: string[];
  }) => {
    const earned = input.weight * (input.status === "pass" ? 1 : input.status === "partial" ? 0.5 : 0);
    checks.push({
      id: input.id,
      dimension: input.dimension,
      label: input.label,
      weight: input.weight,
      status: input.status,
      earned,
      evidence: input.evidence,
      findingIds: input.findingIds ?? [],
    });
  };

  const readme = ctx.readme;
  const readmeHeadings = readme ? readme.content : "";

  /* ---------------------------- Documentation ---------------------------- */
  if (!readme) {
    const finding = makeFinding({
      ruleId: "readme-missing",
      title: "No README at the repository root",
      category: "documentation",
      dimension: "documentation",
      severity: "high",
      summary: "The scanner found no README file, so there is no first-run guidance for newcomers.",
      whyItMatters:
        "The README is the first artefact a contributor reads. Without it, people must reverse-engineer how the project is meant to be installed and used, which usually means they leave.",
      evidence: [
        {
          label: "Repository file listing",
          note: "No readme.md, readme.rst or readme.txt was found at the repository root.",
        },
      ],
      recommendation:
        "Add a README that states what the project does, its prerequisites, the exact installation commands, how to run it and how to run the tests.",
      remediation: {
        kind: "manual",
        label: "Author a README from your project knowledge",
        steps: [
          "Create README.md at the repository root.",
          "Describe the project purpose in two or three sentences.",
          "Add prerequisites, installation, usage and test sections with copy-pasteable commands.",
        ],
      },
      confidence: "confirmed",
      validationMethod: "Presence check against the repository file listing.",
      effort: "medium",
      beginnerSuitable: false,
    });
    record({
      id: "DOC-01",
      dimension: "documentation",
      label: "README present",
      weight: 8,
      status: "fail",
      evidence: "No README file found at the repository root.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "DOC-01",
      dimension: "documentation",
      label: "README present",
      weight: 8,
      status: "pass",
      evidence: `${readme.path} (${readme.content.split("\n").length} lines) read from the repository root.`,
    });
  }

  const hasInstall = !!readme && INSTALL_PATTERN.test(readme.content);
  if (!hasInstall) {
    const finding = makeFinding({
      ruleId: "readme-install-missing",
      title: "Installation steps are not documented",
      category: "documentation",
      dimension: "documentation",
      severity: "high",
      summary: `No install command was found in ${readme ? readme.path : "the repository documentation"}.`,
      whyItMatters:
        "A newcomer cannot reproduce a local environment without an install command. This is the single most common reason first-time contributors abandon a repository.",
      evidence: readme
        ? [
            {
              label: `${readme.path} inspected`,
              path: readme.path,
              note: "Checked headings and code blocks for npm/yarn/pnpm/pip/poetry/maven/gradle/go/cargo install commands.",
            },
          ]
        : [{ label: "No README to inspect" }],
      location: readme ? { path: readme.path } : undefined,
      recommendation: ctx.installCommand
        ? `Document the setup sequence starting with \`${ctx.installCommand}\` in a "Getting started" section.`
        : "Document the setup sequence: required runtime, dependency install and first run.",
      remediation: {
        kind: ctx.installCommand ? "auto" : "manual",
        label: ctx.installCommand ? "Insert a Getting started section with the detected install command" : "Document the setup steps manually",
      },
      confidence: "confirmed",
      validationMethod: "Markdown structure check for installation commands in fenced code blocks or inline commands.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "DOC-02",
      dimension: "documentation",
      label: "Installation instructions documented",
      weight: 6,
      status: "fail",
      evidence: readme ? `No install command matched in ${readme.path}.` : "No documentation file available.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "DOC-02",
      dimension: "documentation",
      label: "Installation instructions documented",
      weight: 6,
      status: "pass",
      evidence: `Install command found in ${readme?.path}.`,
    });
  }

  const prereqHeading = readme
    ? findHeading(readmeHeadings, [/requirement/i, /prerequisite/i, /before you (begin|start)/i, /^stack$/i])
    : null;
  const prereqLine = readme ? lineNumberOf(readmeHeadings, PREREQ_PATTERN) : null;
  const hasPrereqs = !!prereqHeading || prereqLine !== null;
  if (!hasPrereqs) {
    const finding = makeFinding({
      ruleId: "readme-prerequisites-missing",
      title: "Runtime prerequisites are not stated",
      category: "documentation",
      dimension: "documentation",
      severity: "medium",
      summary: "The documentation does not state which runtime versions or services the project needs.",
      whyItMatters:
        "Version mismatches produce failures that look like project bugs. Documenting the runtime and required services turns a mystery into a five-minute check.",
      evidence: readme
        ? [
            {
              label: "README headings and body",
              path: readme.path,
              note: "No Requirements/Prerequisites section and no explicit runtime version was detected.",
            },
            ...(ctx.snapshot.ecosystem.id !== "unknown"
              ? [{ label: "Detected ecosystem", note: `${ctx.snapshot.ecosystem.label} (${ctx.snapshot.ecosystem.manifests.join(", ")})` }]
              : []),
          ]
        : [{ label: "No README to inspect" }],
      location: readme ? { path: readme.path } : undefined,
      recommendation: "Add a short Requirements section listing the runtime version, package manager and any required services.",
      remediation: {
        kind: readme ? "auto" : "manual",
        label: readme ? "Append a Requirements section using the detected ecosystem" : "Document prerequisites manually",
      },
      confidence: "needs-review",
      validationMethod: "Markdown heading and version-pattern check.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "DOC-03",
      dimension: "documentation",
      label: "Runtime prerequisites documented",
      weight: 5,
      status: "fail",
      evidence: readme ? "No prerequisites section or version statement found." : "No documentation available.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "DOC-03",
      dimension: "documentation",
      label: "Runtime prerequisites documented",
      weight: 5,
      status: "pass",
      evidence: prereqHeading ? `Prerequisites documented in "${prereqHeading.text}".` : "Runtime version stated in the README.",
    });
  }

  const hasRunDocs = !!readme && RUN_PATTERN.test(readme.content);
  const usageHeading = readme ? findHeading(readmeHeadings, [/usage/i, /quick ?start/i, /running/i, /getting started/i]) : null;
  if (!hasRunDocs) {
    const finding = makeFinding({
      ruleId: "readme-usage-missing",
      title: "No documented way to run the project",
      category: "documentation",
      dimension: "documentation",
      severity: "medium",
      summary: "The documentation explains installation but not how to start or use the project.",
      whyItMatters:
        "Contributors need a feedback loop. Without a run command they cannot see the effect of their change, so they cannot validate their own work.",
      evidence: [{ label: "README command scan", path: readme?.path, note: "No run/dev/start command was detected." }],
      location: readme ? { path: readme.path } : undefined,
      recommendation: ctx.runCommand ? `Document \`${ctx.runCommand}\` and what a successful start looks like.` : "Document how to start the project and what successful startup output looks like.",
      remediation: {
        kind: readme && ctx.runCommand ? "auto" : "manual",
        label: readme && ctx.runCommand ? "Insert a Usage section with the detected run command" : "Document usage manually",
      },
      confidence: "confirmed",
      validationMethod: "Markdown command scan for run/dev/start instructions.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "DOC-04",
      dimension: "documentation",
      label: "Usage instructions documented",
      weight: 6,
      status: "fail",
      evidence: "No run command found in the documentation.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "DOC-04",
      dimension: "documentation",
      label: "Usage instructions documented",
      weight: 6,
      status: "pass",
      evidence: usageHeading ? `Usage documented in "${usageHeading.text}".` : "A run command is present in the README.",
    });
  }

  /* ------------------------------- Setup -------------------------------- */
  if (ctx.snapshot.ecosystem.id === "unknown") {
    const finding = makeFinding({
      ruleId: "manifest-missing",
      title: "No supported dependency manifest found",
      category: "setup",
      dimension: "setup",
      severity: "high",
      summary: "The scanner could not find a package.json, pyproject.toml, pom.xml, build.gradle, go.mod or Cargo.toml at the root.",
      whyItMatters:
        "Without a manifest, dependency installation and environment reproduction are undefined. Contributors must guess how to build the project.",
      evidence: [{ label: "Root file listing", note: ctx.snapshot.tree.slice(0, 12).join(", ") || "No files were readable." }],
      recommendation: "Add the manifest for your build system at the repository root, or document the build system explicitly if it is unusual.",
      remediation: {
        kind: "manual",
        label: "Add or document the build manifest",
        steps: [
          "Add the manifest used by your build system at the repository root.",
          "Document the install and build commands in the README.",
        ],
      },
      confidence: "needs-review",
      validationMethod: "Ecosystem manifest presence check.",
      effort: "medium",
      beginnerSuitable: false,
    });
    record({
      id: "SETUP-01",
      dimension: "setup",
      label: "Dependency manifest present",
      weight: 6,
      status: "fail",
      evidence: "No supported manifest detected at the repository root.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "SETUP-01",
      dimension: "setup",
      label: "Dependency manifest present",
      weight: 6,
      status: "pass",
      evidence: `${ctx.snapshot.ecosystem.label}: ${ctx.snapshot.ecosystem.manifests.join(", ")}`,
    });
  }

  const lockPattern = LOCKFILES[ctx.snapshot.ecosystem.id];
  const lockfile = ctx.snapshot.tree.find((path) => lockPattern.test(path));
  if (ctx.snapshot.ecosystem.id === "unknown") {
    record({
      id: "SETUP-02",
      dimension: "setup",
      label: "Lockfile committed",
      weight: 7,
      status: "not-applicable",
      evidence: "No ecosystem detected, so lockfile expectations cannot be applied.",
    });
  } else if (!lockfile) {
    const finding = makeFinding({
      ruleId: "lockfile-missing",
      title: "No dependency lockfile is committed",
      category: "setup",
      dimension: "setup",
      severity: "medium",
      summary: `A ${ctx.snapshot.ecosystem.label} manifest exists but no matching lockfile was found.`,
      whyItMatters:
        "Without a lockfile, installs resolve different versions over time. Bugs reported by a contributor become irreproducible for maintainers.",
      evidence: [
        {
          label: "Lockfile presence check",
          note: `Expected one of: ${lockPattern.source.replace(/[\^$]/g, "")}`,
        },
      ],
      recommendation: ctx.snapshot.ecosystem.id === "node" ? "Commit the lockfile generated by your package manager (`npm install` writes package-lock.json)." : "Commit the lockfile generated by your package manager.",
      remediation: {
        kind: "manual",
        label: "Generate and commit a lockfile",
        steps: [
          "Run your package manager's install command locally to generate the lockfile.",
          "Commit the generated lockfile and document the pinned package manager version.",
        ],
      },
      confidence: "confirmed",
      validationMethod: "Root file listing matched against ecosystem lockfile conventions.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "SETUP-02",
      dimension: "setup",
      label: "Lockfile committed",
      weight: 7,
      status: "fail",
      evidence: `No lockfile matching ${lockPattern.source.replace(/[\^$]/g, "")}.`,
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "SETUP-02",
      dimension: "setup",
      label: "Lockfile committed",
      weight: 7,
      status: "pass",
      evidence: `Lockfile present: ${lockfile}`,
    });
  }

  const envRequired = ctx.envKeys.length > 0;
  if (!envRequired) {
    record({
      id: "SETUP-03",
      dimension: "setup",
      label: "Environment variables documented",
      weight: 7,
      status: "not-applicable",
      evidence: "No environment variable reads were detected in the analysed files.",
    });
  } else if (!ctx.envTemplate) {
    const finding = makeFinding({
      ruleId: "env-template-missing",
      title: "Configuration variables are required but undocumented",
      category: "setup",
      dimension: "setup",
      severity: "high",
      summary: `The code reads ${ctx.envKeys.length} environment variable${ctx.envKeys.length === 1 ? "" : "s"} (${ctx.envKeys.map((entry) => entry.key).join(", ")}) but no .env.example template exists.`,
      whyItMatters:
        "Undocumented environment variables stop the application from starting. Contributors cannot tell whether a startup failure is their mistake or a repository bug.",
      evidence: ctx.envKeys.slice(0, 4).map((entry) => ({
        label: `Environment read: ${entry.key}`,
        path: entry.path,
        startLine: entry.line,
        endLine: entry.line,
        excerpt: excerptAround(ctx.snapshot.files.find((file) => file.path === entry.path)?.content ?? "", entry.line, 0),
      })),
      location: { path: ctx.envKeys[0].path, startLine: ctx.envKeys[0].line },
      recommendation: "Add a committed .env.example that lists every required key with a placeholder value, and document which values are secrets.",
      remediation: { kind: "auto", label: "Create .env.example with placeholders for the detected keys" },
      confidence: "confirmed",
      validationMethod: "Environment-read scan (process.env / os.environ / os.getenv) plus template presence check.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "SETUP-03",
      dimension: "setup",
      label: "Environment variables documented",
      weight: 7,
      status: "fail",
      evidence: `${ctx.envKeys.length} environment reads found; no .env.example template.`,
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "SETUP-03",
      dimension: "setup",
      label: "Environment variables documented",
      weight: 7,
      status: "pass",
      evidence: `Template ${ctx.envTemplate.path} documents ${ctx.envTemplate.keys.length} key(s) for ${ctx.envKeys.length} detected read(s).`,
    });
  }

  if (!envRequired || !ctx.envTemplate) {
    record({
      id: "SETUP-04",
      dimension: "setup",
      label: "Environment template covers every required key",
      weight: 5,
      status: "not-applicable",
      evidence: !envRequired
        ? "No environment variables detected, so template coverage cannot be evaluated."
        : "No template exists yet, so key coverage is not applicable until SETUP-03 is addressed.",
    });
  } else {
    const templateKeys = new Set(ctx.envTemplate.keys);
    const missingKeys = ctx.envKeys.map((entry) => entry.key).filter((key) => !templateKeys.has(key));
    if (missingKeys.length > 0) {
      const finding = makeFinding({
        ruleId: "env-template-incomplete",
        title: "Environment template is missing required keys",
        category: "setup",
        dimension: "setup",
        severity: "medium",
        summary: `${ctx.envTemplate.path} does not document: ${missingKeys.join(", ")}.`,
        whyItMatters:
          "A partially complete template still fails at startup. Contributors follow the documented keys and hit an unexpected crash.",
        evidence: missingKeys.slice(0, 5).map((key) => {
          const entry = ctx.envKeys.find((candidate) => candidate.key === key);
          return {
            label: `Key read but not templated: ${key}`,
            path: entry?.path,
            startLine: entry?.line,
            endLine: entry?.line,
            note: `${ctx.envTemplate?.path} lists ${ctx.envTemplate?.keys.join(", ") || "no keys"}.`,
          };
        }),
        location: { path: ctx.envTemplate.path },
        recommendation: `Document the missing keys (${missingKeys.join(", ")}) in ${ctx.envTemplate.path} with placeholder values.`,
        remediation: { kind: "auto", label: "Append the missing keys to the environment template" },
        confidence: "confirmed",
        validationMethod: "Key-set comparison between environment reads and the committed template.",
        effort: "small",
        beginnerSuitable: true,
      });
      record({
        id: "SETUP-04",
        dimension: "setup",
        label: "Environment template covers every required key",
        weight: 5,
        status: "fail",
        evidence: `Missing template keys: ${missingKeys.join(", ")}.`,
        findingIds: [finding.id],
      });
    } else {
      record({
        id: "SETUP-04",
        dimension: "setup",
        label: "Environment template covers every required key",
        weight: 5,
        status: "pass",
        evidence: "Every detected environment key appears in the committed template.",
      });
    }
  }

  /* ------------------------------ Testing ------------------------------- */
  if (ctx.testsDetected) {
    record({
      id: "TEST-01",
      dimension: "testing",
      label: "Automated tests detected",
      weight: 7,
      status: "pass",
      evidence: ctx.testEvidence.join("; "),
    });
  } else {
    const finding = makeFinding({
      ruleId: "tests-missing",
      title: "No automated test setup detected",
      category: "testing-ci",
      dimension: "testing",
      severity: "high",
      summary: "No test runner configuration, test script or test files were found.",
      whyItMatters:
        "Without tests, contributors cannot check whether their change breaks behaviour, and maintainers must review every change by hand. This is the highest-risk onboarding gap after missing setup docs.",
      evidence: [
        ...(ctx.snapshot.ecosystem.manifests.length > 0
          ? [{ label: "Manifest inspected", path: ctx.snapshot.ecosystem.manifests[0], note: "No test script or test runner dependency found." }]
          : [{ label: "Repository scan", note: "No test files or runner configuration detected." }]),
      ],
      recommendation: `Choose a test runner for ${ctx.snapshot.ecosystem.label}, add a small smoke test and document \`${ctx.testCommand ?? "<test command>"}\` in the README.`,
      remediation: {
        kind: "manual",
        label: "Introduce a test runner and a documented test command",
        steps: [
          "Add your ecosystem's standard test runner as a development dependency.",
          "Commit at least one meaningful test that exercises a public entry point.",
          "Add a test script/configuration and document the test command in the README.",
        ],
      },
      confidence: "confirmed",
      validationMethod: "Test runner configuration, test script and test file presence checks.",
      effort: "large",
      beginnerSuitable: false,
    });
    record({
      id: "TEST-01",
      dimension: "testing",
      label: "Automated tests detected",
      weight: 7,
      status: "fail",
      evidence: "No test script, runner dependency or test files detected.",
      findingIds: [finding.id],
    });
  }

  const testDocsSource = `${readme?.content ?? ""}\n${ctx.contributing?.content ?? ""}`;
  const testCommandDocumented = !!ctx.testCommand && testDocsSource.includes(ctx.testCommand.replace(/^(npm|pnpm|yarn) (run )?/, ""));
  if (!ctx.testsDetected) {
    record({
      id: "TEST-02",
      dimension: "testing",
      label: "Test command documented",
      weight: 5,
      status: "not-applicable",
      evidence: "No test setup exists, so a documented test command cannot be expected yet.",
    });
  } else if (!testCommandDocumented) {
    const finding = makeFinding({
      ruleId: "test-command-undocumented",
      title: "Tests exist but the command is not documented",
      category: "testing-ci",
      dimension: "testing",
      severity: "medium",
      summary: `Test infrastructure was detected (${ctx.testEvidence[0]}), but the documentation does not show how to run it.`,
      whyItMatters:
        "Contributors who do not know the test command ship unverified changes, which pushes validation work back to maintainers.",
      evidence: [
        { label: "Test evidence", note: ctx.testEvidence.join("; ") },
        { label: "Documentation inspected", path: ctx.readme?.path, note: "No matching test command found." },
      ],
      location: ctx.readme ? { path: ctx.readme.path } : undefined,
      recommendation: ctx.testCommand ? `Add a "Running tests" section that documents \`${ctx.testCommand}\`.` : "Document the test command.",
      remediation: {
        kind: ctx.readme ? "auto" : "manual",
        label: ctx.readme ? "Append a Running tests section to the README" : "Document the test command manually",
      },
      confidence: "confirmed",
      validationMethod: "Documentation scan for the detected test command or a test heading.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "TEST-02",
      dimension: "testing",
      label: "Test command documented",
      weight: 5,
      status: "fail",
      evidence: "Tests detected but no documented test command.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "TEST-02",
      dimension: "testing",
      label: "Test command documented",
      weight: 5,
      status: "pass",
      evidence: "The test command appears in the project documentation.",
    });
  }

  const workflow = ctx.ciWorkflows[0];
  if (!workflow) {
    const finding = makeFinding({
      ruleId: "ci-missing",
      title: "No continuous integration workflow",
      category: "testing-ci",
      dimension: "testing",
      severity: "high",
      summary: "No GitHub Actions workflow was found under .github/workflows.",
      whyItMatters:
        "CI is the shared source of truth that a change builds and passes tests. Without it, every contributor must reproduce validation locally and maintainers cannot see evidence before merging.",
      evidence: [{ label: "Workflow directory", note: ".github/workflows does not contain a YAML workflow." }],
      recommendation: `Add a workflow that installs dependencies${ctx.testCommand ? `, runs \`${ctx.testCommand}\`` : ""} and builds the project on pull requests.`,
      remediation: { kind: "auto", label: "Create a GitHub Actions workflow tailored to the detected ecosystem" },
      confidence: "confirmed",
      validationMethod: "Presence check for .github/workflows/*.yml plus YAML syntax validation of generated files.",
      effort: "medium",
      beginnerSuitable: true,
    });
    record({
      id: "TEST-03",
      dimension: "testing",
      label: "CI workflow configured",
      weight: 5,
      status: "fail",
      evidence: "No .github/workflows YAML file found.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "TEST-03",
      dimension: "testing",
      label: "CI workflow configured",
      weight: 5,
      status: "pass",
      evidence: `Workflow present: ${workflow.path}`,
    });
  }

  const ciRunsTests = ctx.ciWorkflows.some((file) =>
    /(npm (run )?test|pnpm test|yarn test|bun test|pytest|go test|mvn test|gradle test|cargo test|dotnet test)/i.test(file.content),
  );
  if (!ctx.testsDetected) {
    record({
      id: "TEST-04",
      dimension: "testing",
      label: "CI executes the test suite",
      weight: 3,
      status: "not-applicable",
      evidence: "There is no test suite to execute, so CI test coverage cannot be evaluated.",
    });
  } else if (!workflow) {
    record({
      id: "TEST-04",
      dimension: "testing",
      label: "CI executes the test suite",
      weight: 3,
      status: "not-applicable",
      evidence: "No CI workflow exists, so there is nothing to inspect for test execution.",
    });
  } else if (!ciRunsTests) {
    const line = lineNumberOf(workflow.content, /run:/);
    const finding = makeFinding({
      ruleId: "ci-tests-missing",
      title: "CI workflow does not run the tests",
      category: "testing-ci",
      dimension: "testing",
      severity: "medium",
      summary: `${workflow.path} exists but no test command appears in it.`,
      whyItMatters:
        "A workflow that only installs dependencies creates false confidence: the check is green while the test suite is never exercised.",
      evidence: [
        {
          label: "CI steps inspected",
          path: workflow.path,
          startLine: line ?? undefined,
          excerpt: line ? excerptAround(workflow.content, line, 2) : undefined,
          note: "No test command (pytest, npm test, go test, …) matched in the workflow.",
        },
      ],
      location: { path: workflow.path, startLine: line ?? undefined },
      recommendation: ctx.testCommand ? `Add a step that runs \`${ctx.testCommand}\` after dependency installation.` : "Add a test step once the test suite exists.",
      remediation: {
        kind: "manual",
        label: "Add the test step to the existing workflow",
        steps: [
          "Open the existing workflow and keep its current triggers.",
          "Add a step after dependency installation that runs the test command.",
          "Do not duplicate installs: reuse the existing setup steps.",
        ],
      },
      confidence: "confirmed",
      validationMethod: "Workflow content scan for recognised test commands.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "TEST-04",
      dimension: "testing",
      label: "CI executes the test suite",
      weight: 3,
      status: "fail",
      evidence: `${workflow.path} contains no test command.`,
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "TEST-04",
      dimension: "testing",
      label: "CI executes the test suite",
      weight: 3,
      status: "pass",
      evidence: "A test command appears in the CI workflow.",
    });
  }

  /* --------------------------- Contribution ----------------------------- */
  if (!ctx.contributing) {
    const finding = makeFinding({
      ruleId: "contributing-missing",
      title: "No CONTRIBUTING guide",
      category: "contribution",
      dimension: "contribution",
      severity: "medium",
      summary: "No CONTRIBUTING.md or docs/contributing file was found.",
      whyItMatters:
        "Contribution guides set expectations for branches, commits, review and tests. Without one, first-time contributors guess at process and often submit changes that cannot be merged.",
      evidence: [{ label: "File listing", note: "No CONTRIBUTING.md or docs/contributing.md present." }],
      recommendation: "Add a CONTRIBUTING.md that covers the local setup, test command, branch/commit expectations and how to get help.",
      remediation: { kind: "auto", label: "Create CONTRIBUTING.md using evidence from this scan" },
      confidence: "confirmed",
      validationMethod: "File presence check plus Markdown structure validation of generated content.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "CONTRIB-01",
      dimension: "contribution",
      label: "CONTRIBUTING guide present",
      weight: 6,
      status: "fail",
      evidence: "No contribution guide found.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "CONTRIB-01",
      dimension: "contribution",
      label: "CONTRIBUTING guide present",
      weight: 6,
      status: "pass",
      evidence: `Guide present: ${ctx.contributing.path}`,
    });
  }

  const conduct = findFile(ctx.snapshot, CONDUCT_PATTERN);
  if (!conduct) {
    const finding = makeFinding({
      ruleId: "code-of-conduct-missing",
      title: "No code of conduct",
      category: "contribution",
      dimension: "contribution",
      severity: "low",
      summary: "No CODE_OF_CONDUCT file or .github conduct file was found.",
      whyItMatters:
        "A code of conduct states expected behaviour and a reporting route for problems, which makes participation safer for newcomers.",
      evidence: [{ label: "File listing", note: "No CODE_OF_CONDUCT.md present." }],
      recommendation: "Adopt a code of conduct (for example Contributor Covenant 2.1) and name a reporting contact.",
      remediation: { kind: "auto", label: "Add a CODE_OF_CONDUCT.md starter" },
      confidence: "confirmed",
      validationMethod: "File presence check plus Markdown structure validation.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "CONTRIB-02",
      dimension: "contribution",
      label: "Code of conduct present",
      weight: 3,
      status: "fail",
      evidence: "No code of conduct file found.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "CONTRIB-02",
      dimension: "contribution",
      label: "Code of conduct present",
      weight: 3,
      status: "pass",
      evidence: `Code of conduct present: ${conduct.path}`,
    });
  }

  const hasIssueTemplate = ctx.snapshot.tree.some((path) => /^\.github\/ISSUE_TEMPLATE\//i.test(path));
  const hasPrTemplate = ctx.snapshot.tree.some((path) => /^(\.github\/)?pull_request_template(\.md)?$/i.test(path));
  if (!hasIssueTemplate && !hasPrTemplate) {
    const finding = makeFinding({
      ruleId: "templates-missing",
      title: "No issue or pull request templates",
      category: "contribution",
      dimension: "contribution",
      severity: "low",
      summary: "The repository has no .github issue templates and no pull request template.",
      whyItMatters:
        "Templates prompt contributors for reproduction steps and validation evidence, which reduces review round-trips.",
      evidence: [{ label: "GitHub directory scan", note: "No .github/ISSUE_TEMPLATE/* or PULL_REQUEST_TEMPLATE.md found." }],
      recommendation: "Add a bug report template and a pull request template that asks for problem, change and validation evidence.",
      remediation: { kind: "auto", label: "Add issue and pull request templates" },
      confidence: "confirmed",
      validationMethod: "Presence check for template paths plus Markdown structure validation.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "CONTRIB-03",
      dimension: "contribution",
      label: "Issue/PR templates present",
      weight: 4,
      status: "fail",
      evidence: "No issue or pull request templates found.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "CONTRIB-03",
      dimension: "contribution",
      label: "Issue/PR templates present",
      weight: 4,
      status: hasIssueTemplate && hasPrTemplate ? "pass" : "partial",
      evidence: `Issue templates: ${hasIssueTemplate ? "present" : "missing"}; PR template: ${hasPrTemplate ? "present" : "missing"}.`,
    });
  }

  if (!ctx.contributing) {
    record({
      id: "CONTRIB-04",
      dimension: "contribution",
      label: "Contribution workflow documented",
      weight: 2,
      status: "not-applicable",
      evidence: "No contribution guide to inspect.",
    });
  } else {
    const contributingContent = ctx.contributing.content;
    const documentsSetup = INSTALL_PATTERN.test(contributingContent) || /poetry install|npm install|pip install/i.test(contributingContent);
    const testsRequired = ctx.testsDetected && Boolean(ctx.testCommand);
    const documentsTests = !!ctx.testCommand && contributingContent.toLowerCase().includes(ctx.testCommand.toLowerCase());
    const workflowComplete = documentsSetup && (!testsRequired || documentsTests);
    const status: CheckStatus = workflowComplete ? "pass" : documentsSetup || documentsTests ? "partial" : "fail";
    let findingIds: string[] = [];
    if (status !== "pass") {
      const finding = makeFinding({
        ruleId: "contribution-workflow-undocumented",
        title: "Contribution guide omits setup or test steps",
        category: "contribution",
        dimension: "contribution",
        severity: "low",
        summary: `${ctx.contributing.path} does not document ${documentsSetup ? "the test command" : "the local setup"} that this repository requires.`,
        whyItMatters:
          "Contribution guidance is only actionable when it includes the commands a contributor must run before requesting review.",
        evidence: [
          {
            label: "Contribution guide inspected",
            path: ctx.contributing.path,
            note: `Setup instructions: ${documentsSetup ? "found" : "missing"}; test command: ${
            testsRequired ? (documentsTests ? "found" : "missing") : "not applicable (no test suite detected)"
          }.`,
          },
        ],
        location: { path: ctx.contributing.path },
        recommendation: "Add a Development setup section with the exact install and test commands.",
        remediation: { kind: "auto", label: "Append a Development setup section to CONTRIBUTING.md" },
        confidence: "confirmed",
        validationMethod: "Command scan inside the contribution guide.",
        effort: "small",
        beginnerSuitable: true,
      });
      findingIds = [finding.id];
    }
    record({
      id: "CONTRIB-04",
      dimension: "contribution",
      label: "Contribution workflow documented",
      weight: 2,
      status,
      evidence:
        status === "pass"
          ? "Contribution guide documents setup and test commands."
          : "Contribution guide is missing setup and/or test commands.",
      findingIds,
    });
  }

  /* ------------------------------ Hygiene ------------------------------- */
  if (!ctx.licenseFile) {
    const finding = makeFinding({
      ruleId: "license-missing",
      title: "No license file",
      category: "metadata",
      dimension: "hygiene",
      severity: "medium",
      summary: "No LICENSE or COPYING file was found at the repository root.",
      whyItMatters:
        "Without a license, the legal terms for using and contributing to the code are undefined. Many organisations forbid contributing to unlicensed projects.",
      evidence: [
        { label: "File listing", note: "No LICENSE, LICENCE or COPYING file found." },
        ...(readme ? [{ label: "README license section", path: readme.path, note: "A README mention is not a license grant." }] : []),
      ],
      recommendation: "Choose a license with the maintainers (for example MIT or Apache-2.0), commit the full license text and add the SPDX identifier to the manifest.",
      remediation: {
        kind: "manual",
        label: "License choice requires a maintainer decision",
        steps: [
          "Agree on a license with the repository maintainers.",
          "Commit the official license text as LICENSE.",
          "Add the SPDX identifier to the package manifest and the README.",
        ],
      },
      confidence: "confirmed",
      validationMethod: "License file presence check. RepoRescue does not choose licenses automatically.",
      effort: "small",
      beginnerSuitable: false,
    });
    record({
      id: "HYG-01",
      dimension: "hygiene",
      label: "License file present",
      weight: 5,
      status: "fail",
      evidence: "No license text file found.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "HYG-01",
      dimension: "hygiene",
      label: "License file present",
      weight: 5,
      status: "pass",
      evidence: `License present: ${ctx.licenseFile.path}${ctx.licenseSpdx ? ` (detected ${ctx.licenseSpdx})` : ""}`,
    });
  }

  const manifestApplies = ctx.snapshot.ecosystem.id === "node";
  if (!manifestApplies) {
    record({
      id: "HYG-02",
      dimension: "hygiene",
      label: "Manifest declares a license",
      weight: 2,
      status: "not-applicable",
      evidence:
        ctx.snapshot.ecosystem.id === "unknown"
          ? "No manifest available."
          : "Only package.json license metadata is checked automatically for this ecosystem.",
    });
  } else if (!ctx.manifestLicense) {
    const finding = makeFinding({
      ruleId: "manifest-license-missing",
      title: "package.json does not declare a license",
      category: "dependency-hygiene",
      dimension: "hygiene",
      severity: "low",
      summary: "The npm manifest has no license field, so tooling and consumers cannot determine the terms.",
      whyItMatters:
        "npm registries and license scanners read the manifest field. Missing metadata causes false unknown-license reports.",
      evidence: [
        {
          label: "package.json inspected",
          path: "package.json",
          note: ctx.licenseSpdx
            ? `A ${ctx.licenseSpdx} license file exists, but the manifest omits the field.`
            : "No license field found and no license file from which to derive an SPDX identifier.",
        },
      ],
      location: { path: "package.json", startLine: lineNumberOf(ctx.snapshot.files.find((file) => file.path === "package.json")?.content ?? "", /"name"/) ?? undefined },
      recommendation: ctx.licenseSpdx
        ? `Add "license": "${ctx.licenseSpdx}" to package.json to match the committed license file.`
        : "Choose a license, commit the license text, then declare the SPDX identifier in package.json.",
      remediation: ctx.licenseSpdx
        ? { kind: "auto", label: `Add "license": "${ctx.licenseSpdx}" to package.json` }
        : { kind: "manual", label: "Declare a license after the maintainers choose one" },
      confidence: "confirmed",
      validationMethod: "JSON manifest field check plus JSON syntax validation of any generated patch.",
      effort: "small",
      beginnerSuitable: Boolean(ctx.licenseSpdx),
    });
    record({
      id: "HYG-02",
      dimension: "hygiene",
      label: "Manifest declares a license",
      weight: 2,
      status: "fail",
      evidence: "package.json has no license field.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "HYG-02",
      dimension: "hygiene",
      label: "Manifest declares a license",
      weight: 2,
      status: "pass",
      evidence: `package.json declares license: ${ctx.manifestLicense}`,
    });
  }

  const gitignore = ctx.snapshot.tree.find((path) => path === ".gitignore");
  if (!gitignore) {
    const finding = makeFinding({
      ruleId: "gitignore-missing",
      title: "No .gitignore",
      category: "dependency-hygiene",
      dimension: "hygiene",
      severity: "low",
      summary: "The repository root has no .gitignore, so build output and local configuration can be committed by accident.",
      whyItMatters:
        "Accidental commits of build output and local configuration create noisy reviews and can leak credentials.",
      evidence: [{ label: "Root file listing", note: "No .gitignore found." }],
      recommendation: "Add a .gitignore covering dependencies, build output, local environment files and test artefacts.",
      remediation: { kind: "auto", label: "Create a .gitignore for the detected ecosystem" },
      confidence: "confirmed",
      validationMethod: "File presence check plus pattern review of generated content.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "HYG-03",
      dimension: "hygiene",
      label: ".gitignore present",
      weight: 3,
      status: "fail",
      evidence: "No .gitignore found.",
      findingIds: [finding.id],
    });
  } else {
    record({
      id: "HYG-03",
      dimension: "hygiene",
      label: ".gitignore present",
      weight: 3,
      status: "pass",
      evidence: ".gitignore is present at the repository root.",
    });
  }

  const meta = ctx.snapshot.repository;
  const hasDescription = !!meta.description && meta.description.trim().length > 0;
  const hasTopics = meta.topics.length > 0;
  if (hasDescription && hasTopics) {
    record({
      id: "HYG-04",
      dimension: "hygiene",
      label: "Repository description and topics set",
      weight: 2,
      status: "pass",
      evidence: `Description present; ${meta.topics.length} topic(s).`,
    });
  } else {
    const finding = makeFinding({
      ruleId: "metadata-incomplete",
      title: "Repository discoverability metadata is incomplete",
      category: "metadata",
      dimension: "hygiene",
      severity: "info",
      summary: hasDescription ? "The repository has no topics, so it is hard to discover by domain." : "The repository has no description.",
      whyItMatters:
        "Description and topics drive GitHub search and help contributors decide whether the project matches their interests before reading code.",
      evidence: [
        {
          label: "GitHub repository metadata",
          note: `description: ${hasDescription ? "present" : "missing"}; topics: ${hasTopics ? meta.topics.join(", ") : "none"}.`,
        },
      ],
      recommendation: "Add a one-line description and a few domain topics in the GitHub repository settings.",
      remediation: {
        kind: "manual",
        label: "Repository settings cannot be changed by a patch",
        steps: [
          "Open the repository settings on GitHub.",
          "Add a concise description and 3-6 relevant topics.",
        ],
      },
      confidence: "confirmed",
      validationMethod: "GitHub repository metadata field check.",
      effort: "small",
      beginnerSuitable: true,
    });
    record({
      id: "HYG-04",
      dimension: "hygiene",
      label: "Repository description and topics set",
      weight: 2,
      status: hasDescription || hasTopics ? "partial" : "fail",
      evidence: `description: ${hasDescription ? "present" : "missing"}; topics: ${hasTopics ? "present" : "missing"}.`,
      findingIds: [finding.id],
    });
  }

  if (ctx.committedEnvFiles.length === 0) {
    record({
      id: "HYG-05",
      dimension: "hygiene",
      label: "No committed secret/environment files",
      weight: 3,
      status: "pass",
      evidence: "No .env or .env.* files are committed to the repository.",
    });
  } else {
    const finding = makeFinding({
      ruleId: "committed-env-file",
      title: "A local environment file is committed",
      category: "security",
      dimension: "hygiene",
      severity: "high",
      summary: `The repository contains ${ctx.committedEnvFiles.join(", ")}, which normally holds local or secret configuration.`,
      whyItMatters:
        "Committed environment files leak configuration and often credentials. Removing them from the working tree does not remove them from history.",
      evidence: [
        {
          label: "Committed environment file",
          path: ctx.committedEnvFiles[0],
          note: "RepoRescue never displays values from environment files. A human must review the contents and history.",
        },
      ],
      location: { path: ctx.committedEnvFiles[0] },
      recommendation: "Remove the file from the working tree, rotate anything it contained, add it to .gitignore and consider rewriting history.",
      remediation: {
        kind: "manual",
        label: "Secret rotation and history review require a human",
        steps: [
          "Treat every value in the file as compromised and rotate the credentials.",
          "Remove the file, add it to .gitignore and commit a placeholder template instead.",
          "Review repository history and purge the file if required.",
        ],
      },
      confidence: "needs-review",
      validationMethod: "File-name presence check only; contents are deliberately not read or displayed.",
      effort: "medium",
      beginnerSuitable: false,
    });
    record({
      id: "HYG-05",
      dimension: "hygiene",
      label: "No committed secret/environment files",
      weight: 3,
      status: "fail",
      evidence: `Committed environment files: ${ctx.committedEnvFiles.join(", ")}.`,
      findingIds: [finding.id],
    });
  }

  return { checks, findings };
}

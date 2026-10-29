/**
 * RepoRescue shared domain contracts.
 *
 * These types are the single source of truth for the REST API, the analysis
 * engine and the React client. Nothing in the client is allowed to invent a
 * score, finding or verification state: it renders what the server returned.
 */

export type ScanMode = "demo" | "live";
export type ScanStatus = "completed" | "completed-with-limits";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export type FindingCategory =
  | "documentation"
  | "setup"
  | "testing-ci"
  | "dependency-hygiene"
  | "contribution"
  | "metadata"
  | "security";

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  documentation: "Documentation & onboarding",
  setup: "Setup & configuration",
  "testing-ci": "Testing & CI",
  "dependency-hygiene": "Dependency & hygiene",
  contribution: "Contribution guidance",
  metadata: "Repository metadata",
  security: "Security configuration",
};

export type DimensionId = "documentation" | "setup" | "testing" | "contribution" | "hygiene";

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  documentation: "Documentation & onboarding",
  setup: "Reproducible setup",
  testing: "Testing & CI",
  contribution: "Contribution guidance",
  hygiene: "Configuration & hygiene",
};

/** Documented weights. They must always sum to 100. */
export const DIMENSION_WEIGHTS: Record<DimensionId, number> = {
  documentation: 25,
  setup: 25,
  testing: 20,
  contribution: 15,
  hygiene: 15,
};

export type Confidence = "confirmed" | "needs-review";
export type FindingStatus = "open" | "resolved";
export type RemediationKind = "auto" | "manual";

export type Evidence = {
  label: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  excerpt?: string;
  note?: string;
};

export type Finding = {
  /** Stable per scan: generated from the rule id (and file, when relevant). */
  id: string;
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
  remediation: {
    kind: RemediationKind;
    label: string;
    /** Set for manual findings: concrete steps a contributor can follow. */
    steps?: string[];
  };
  confidence: Confidence;
  validationMethod: string;
  effort: "small" | "medium" | "large";
  beginnerSuitable: boolean;
  status: FindingStatus;
};

export type CheckStatus = "pass" | "partial" | "fail" | "not-applicable";

export type CheckEvaluation = {
  id: string;
  dimension: DimensionId;
  label: string;
  weight: number;
  status: CheckStatus;
  earned: number;
  evidence: string;
  findingIds: string[];
};

export type DimensionScore = {
  id: DimensionId;
  label: string;
  weight: number;
  /** 0-100, or null when no check in the dimension was applicable. */
  score: number | null;
  earned: number;
  possible: number;
  checks: CheckEvaluation[];
};

export type ScoreDeduction = {
  checkId: string;
  label: string;
  dimension: DimensionId;
  points: number;
  reason: string;
};

export type ReadinessScore = {
  /** 0-100 integer, rounded from the weighted dimension average. */
  total: number;
  /** Share of the 100 documented weight points that were applicable. */
  coverage: number;
  dimensions: DimensionScore[];
  deductions: ScoreDeduction[];
  formula: string;
  limitations: string[];
};

export type EcosystemId = "node" | "python" | "java" | "go" | "rust" | "unknown";

export type Ecosystem = {
  id: EcosystemId;
  label: string;
  manifests: string[];
  evidence: string[];
  primaryLanguage: string | null;
};

export type RepositoryMeta = {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  topics: string[];
  license: { spdxId: string; name: string } | null;
  stars: number;
  openIssues: number;
  pushedAt: string | null;
  primaryLanguage: string | null;
  /** True when the metadata came from a bundled fixture rather than GitHub. */
  fixture: boolean;
};

export type SnapshotFile = {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

export type RepositorySnapshot = {
  repository: RepositoryMeta;
  files: SnapshotFile[];
  /** Bounded path listing (no content), used for presence checks. */
  tree: string[];
  ecosystem: Ecosystem;
  mode: ScanMode;
  fetchedAt: string;
  analysisLimitations: string[];
};

export type ScanSummary = {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  autoFixable: number;
  manualOnly: number;
  beginnerFriendly: number;
};

/** Full assessment stored server-side (includes the snapshot so that fix
 * generation later in the workflow can reuse the exact scanned evidence). */
export type StoredAssessment = {
  scanId: string;
  mode: ScanMode;
  status: ScanStatus;
  repository: RepositoryMeta;
  ecosystem: Ecosystem;
  createdAt: string;
  findings: Finding[];
  score: ReadinessScore;
  summary: ScanSummary;
  limitations: string[];
  nextSteps: string[];
  snapshot: RepositorySnapshot;
  storage: "database" | "memory";
};

/** Client-safe scan payload: identical to StoredAssessment minus file bodies. */
export type ScanDetail = Omit<StoredAssessment, "snapshot"> & {
  snapshot: {
    fileCount: number;
    treeCount: number;
    paths: string[];
    fetchedAt: string;
    analysisLimitations: string[];
  };
};

export type ScanHistoryItem = {
  scanId: string;
  repository: string;
  repositoryUrl: string;
  mode: ScanMode;
  status: ScanStatus;
  score: number;
  coverage: number;
  findings: number;
  createdAt: string;
  storage: "database" | "memory";
};

export type PatchFile = {
  path: string;
  changeType: "create" | "modify";
  original: string | null;
  proposed: string;
  diff: string;
  additions: number;
  deletions: number;
};

export type ValidationState = "passed" | "failed" | "skipped" | "unavailable";

export type ValidationCheck = {
  id: string;
  label: string;
  state: ValidationState;
  detail: string;
};

export type RemediationProposal = {
  id: string;
  findingId: string;
  findingTitle: string;
  kind: "patch" | "manual";
  outcome: string;
  files: PatchFile[];
  validation: ValidationCheck[];
  overallValidation: ValidationState;
  limitations: string[];
  assumptions: string[];
  instructions: string[];
  generatedAt: string;
};

export type PullRequestDraft = {
  title: string;
  branch: string;
  baseBranch: string;
  description: string;
  files: { path: string; changeType: "create" | "modify"; additions: number; deletions: number }[];
  checklist: { label: string; done: boolean; note?: string }[];
  boundaryNote: string;
};

export type VerificationCheckState = ValidationState | "not-run";

export type VerificationCheck = {
  id: string;
  label: string;
  state: VerificationCheckState;
  detail: string;
};

export type VerificationComparison = {
  beforeScore: number;
  afterScore: number;
  beforeOpenFindings: number;
  afterOpenFindings: number;
  resolved: { id: string; title: string }[];
  remaining: { id: string; title: string }[];
  newlyDetected: { id: string; title: string }[];
  explanation: string;
};

export type VerificationRecord = {
  id: string;
  scanId: string;
  repository: string;
  mode: ScanMode;
  scope: "local";
  status: "passed" | "failed" | "partial" | "unavailable";
  createdAt: string;
  findingIds: string[];
  checks: VerificationCheck[];
  comparison: VerificationComparison | null;
  remote: {
    ci: VerificationCheckState;
    pullRequest: VerificationCheckState;
    reason: string;
  };
  limitations: string[];
  summary: string;
};

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryAfterSeconds?: number;
  };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Server-recorded scan lifecycle phase (real work, never invented). */
export type ScanProgress = {
  id: string;
  status: "running" | "complete" | "failed";
  phases: { key: string; label: string; at: string }[];
  elapsedMs: number;
};

export type DemoRepository = {
  id: string;
  label: string;
  repository: string;
  description: string;
  ecosystem: string;
  headline: string;
  fixtureNote: string;
};

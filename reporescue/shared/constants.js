/**
 * RepoRescue shared domain contracts.
 *
 * These types are the single source of truth for the REST API, the analysis
 * engine and the React client. Nothing in the client is allowed to invent a
 * score, finding or verification state: it renders what the server returned.
 */
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const CATEGORY_LABELS = {
    documentation: "Documentation & onboarding",
    setup: "Setup & configuration",
    "testing-ci": "Testing & CI",
    "dependency-hygiene": "Dependency & hygiene",
    contribution: "Contribution guidance",
    metadata: "Repository metadata",
    security: "Security configuration",
};
export const DIMENSION_LABELS = {
    documentation: "Documentation & onboarding",
    setup: "Reproducible setup",
    testing: "Testing & CI",
    contribution: "Contribution guidance",
    hygiene: "Configuration & hygiene",
};
/** Documented weights. They must always sum to 100. */
export const DIMENSION_WEIGHTS = {
    documentation: 25,
    setup: 25,
    testing: 20,
    contribution: 15,
    hygiene: 15,
};

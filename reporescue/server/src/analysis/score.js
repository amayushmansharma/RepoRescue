import { DIMENSION_LABELS, DIMENSION_WEIGHTS, SEVERITIES, } from "../../../shared/constants.js";
const DIMENSION_ORDER = ["documentation", "setup", "testing", "contribution", "hygiene"];
export const SCORE_FORMULA = "score = round(100 × Σ earned check weight / Σ applicable check weight). Dimension scores use the same ratio within each dimension. Documented weights: documentation 25, setup 25, testing 20, contribution 15, hygiene 15.";
export function computeScore(checks) {
    const dimensions = DIMENSION_ORDER.map((id) => {
        const dimensionChecks = checks.filter((check) => check.dimension === id);
        const applicable = dimensionChecks.filter((check) => check.status !== "not-applicable");
        const earned = applicable.reduce((total, check) => total + check.earned, 0);
        const possible = applicable.reduce((total, check) => total + check.weight, 0);
        return {
            id,
            label: DIMENSION_LABELS[id],
            weight: DIMENSION_WEIGHTS[id],
            score: possible > 0 ? Math.round((earned / possible) * 100) : null,
            earned: round1(earned),
            possible,
            checks: dimensionChecks,
        };
    });
    const applicableChecks = checks.filter((check) => check.status !== "not-applicable");
    const totalEarned = applicableChecks.reduce((total, check) => total + check.earned, 0);
    const totalPossible = applicableChecks.reduce((total, check) => total + check.weight, 0);
    const notApplicable = checks.filter((check) => check.status === "not-applicable");
    const deductions = checks
        .filter((check) => check.status === "fail" || check.status === "partial")
        .map((check) => ({
        checkId: check.id,
        label: check.label,
        dimension: check.dimension,
        points: round1(check.weight - check.earned),
        reason: check.evidence,
    }))
        .sort((a, b) => b.points - a.points || a.checkId.localeCompare(b.checkId))
        .slice(0, 6);
    const limitations = [
        "The score measures contribution readiness (documentation, setup, CI, guidance and hygiene), not code quality, security posture or design.",
        "A repository with thin public metadata but excellent engineering can still score low; deductions list exactly which evidence is missing.",
    ];
    if (notApplicable.length > 0) {
        limitations.push(`${notApplicable.length} check${notApplicable.length === 1 ? "" : "s"} were not applicable and excluded from the denominator: ${notApplicable
            .map((check) => `${check.id} (${check.label})`)
            .join(", ")}.`);
    }
    if (totalPossible < 100) {
        limitations.push(`Coverage is ${round1(totalPossible)} of 100 documented weight points because checks that do not apply to this repository were excluded.`);
    }
    return {
        total: totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0,
        coverage: round1(totalPossible),
        dimensions,
        deductions,
        formula: SCORE_FORMULA,
        limitations,
    };
}
export function summariseFindings(findings) {
    const bySeverity = SEVERITIES.reduce((accumulator, severity) => {
        accumulator[severity] = findings.filter((finding) => finding.severity === severity).length;
        return accumulator;
    }, {});
    return {
        totalFindings: findings.length,
        bySeverity,
        autoFixable: findings.filter((finding) => finding.remediation.kind === "auto").length,
        manualOnly: findings.filter((finding) => finding.remediation.kind === "manual").length,
        beginnerFriendly: findings.filter((finding) => finding.beginnerSuitable).length,
    };
}
export function scoreDelta(before, after) {
    return after - before;
}
function round1(value) {
    return Math.round(value * 10) / 10;
}

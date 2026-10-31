import { randomUUID } from "node:crypto";
import { evaluateRepository } from "./rules.js";
import { computeScore } from "./score.js";
import { applyPlanToSnapshot, buildRemediationPlan } from "./remediations.js";
import { isSafeRepositoryPath } from "./validators.js";
const LOCAL_CHECKS = ["proposal-set", "patch-safety", "file-syntax", "workspace-recheck"];
export function runLocalVerification(input) {
    const now = input.now ?? new Date().toISOString();
    const snapshot = input.assessment.snapshot;
    const findings = input.assessment.findings;
    const selected = findings.filter((finding) => input.findingIds.includes(finding.id));
    const plan = buildRemediationPlan(snapshot, findings, input.findingIds, now);
    const patchProposals = plan.proposals.filter((proposal) => proposal.kind === "patch");
    const automatableSelected = selected.filter((finding) => finding.remediation.kind === "auto");
    const checks = [];
    const proposalCoverage = automatableSelected.every((finding) => patchProposals.some((proposal) => proposal.findingId === finding.id));
    checks.push({
        id: "proposal-set",
        label: "Every selected automated finding has a patch",
        state: automatableSelected.length === 0 ? "skipped" : proposalCoverage ? "passed" : "failed",
        detail: automatableSelected.length === 0
            ? "No selected finding offered a safe automatic remediation, so there is no patch to verify."
            : `${patchProposals.length} patch proposal(s) cover ${automatableSelected.length} automated finding(s).`,
    });
    const paths = plan.patchedFiles.map((file) => file.path);
    const uniquePaths = new Set(paths);
    const safetyPassed = paths.every((path) => isSafeRepositoryPath(path)) && uniquePaths.size === paths.length;
    checks.push({
        id: "patch-safety",
        label: "Patch paths and limits",
        state: paths.length === 0 ? "skipped" : safetyPassed ? "passed" : "failed",
        detail: paths.length === 0
            ? "No files would be written."
            : safetyPassed
                ? `${paths.length} unique in-repository path(s) passed traversal, encoding and size checks.`
                : "One or more paths failed traversal/duplication checks.",
    });
    const fileChecks = patchProposals.flatMap((proposal) => proposal.validation.filter((check) => check.id !== "patch-consistency"));
    const failedFileChecks = fileChecks.filter((check) => check.state === "failed");
    const syntaxState = fileChecks.length === 0 ? "skipped" : failedFileChecks.length > 0 ? "failed" : "passed";
    checks.push({
        id: "file-syntax",
        label: "Available file validators",
        state: syntaxState,
        detail: fileChecks.length === 0
            ? "No selected change had an applicable file validator."
            : `${fileChecks.length - failedFileChecks.length}/${fileChecks.length} validator result(s) passed. JSON, YAML, workflow-structure, markdown, env-template and gitignore checks run locally; no repository code is executed.`,
    });
    const patchedSnapshot = applyPlanToSnapshot(snapshot, plan);
    const after = evaluateRepository(patchedSnapshot);
    const afterScore = computeScore(after.checks);
    const afterIds = new Set(after.findings.map((finding) => finding.id));
    const resolved = selected.filter((finding) => !afterIds.has(finding.id));
    const selectedStillOpen = selected.filter((finding) => afterIds.has(finding.id) && finding.remediation.kind === "auto");
    const recheckState = plan.patchedFiles.length === 0 ? "skipped" : selectedStillOpen.length === 0 ? "passed" : "failed";
    checks.push({
        id: "workspace-recheck",
        label: "Findings re-checked against the patched workspace",
        state: recheckState,
        detail: plan.patchedFiles.length === 0
            ? "No patched workspace could be produced, so no re-check was possible."
            : `${resolved.length} of ${electAutomatable(selected).length} automated selected finding(s) no longer reproduce in the patched workspace. ${selectedStillOpen.length > 0 ? `Still detected: ${selectedStillOpen.map((finding) => finding.ruleId).join(", ")}.` : ""}`,
    });
    checks.push({
        id: "score-recalculation",
        label: "Readiness score recalculated",
        state: plan.patchedFiles.length === 0 ? "skipped" : "passed",
        detail: plan.patchedFiles.length === 0
            ? "Score unchanged because no patch was applied in the workspace."
            : `Score recomputed from the patched workspace: ${input.assessment.score.total} → ${afterScore.total} (coverage ${input.assessment.score.coverage} → ${afterScore.coverage}).`,
    });
    checks.push({
        id: "code-execution",
        label: "Repository code and tests executed",
        state: "skipped",
        detail: "Deliberately not performed: RepoRescue never installs dependencies or runs repository code. A green result here is not proof that the project works.",
    });
    checks.push({
        id: "remote-ci",
        label: "Remote CI status",
        state: "not-run",
        detail: "No commit was pushed, so no CI run exists for these changes.",
    });
    checks.push({
        id: "pull-request",
        label: "Pull request status",
        state: "not-run",
        detail: "No pull request was opened, so there is no merge or review state to report.",
    });
    const localFailures = checks.filter((check) => check.state === "failed" && LOCAL_CHECKS.includes(check.id));
    const status = plan.patchedFiles.length === 0 ? "unavailable" : localFailures.length > 0 ? "failed" : "passed";
    const beforeIds = new Set(findings.map((finding) => finding.id));
    const newlyDetected = after.findings.filter((finding) => !beforeIds.has(finding.id));
    const remaining = after.findings.filter((finding) => !newlyDetected.some((candidate) => candidate.id === finding.id));
    const explanation = plan.patchedFiles.length === 0
        ? "No patch was applied in the local workspace, so RepoRescue cannot report an updated score or resolved findings."
        : `Verification applied ${plan.patchedFiles.length} proposed file change(s) in an in-memory copy of the scanned snapshot and re-ran the full rule set. ${resolved.length} selected finding(s) no longer reproduce. The readiness score moved from ${input.assessment.score.total} to ${afterScore.total}. ${newlyDetected.length > 0
            ? `${newlyDetected.length} new finding(s) became detectable in the patched workspace and are listed separately.`
            : "No new findings were introduced."} This is local evidence about the analysis rules, not a test run of the project and not a CI result.`;
    const comparison = plan.patchedFiles.length === 0
        ? null
        : {
            beforeScore: input.assessment.score.total,
            afterScore: afterScore.total,
            beforeOpenFindings: findings.length,
            afterOpenFindings: after.findings.length,
            resolved: resolved.map((finding) => ({ id: finding.id, title: finding.title })),
            remaining: remaining.map((finding) => ({ id: finding.id, title: finding.title })),
            newlyDetected: newlyDetected.map((finding) => ({ id: finding.id, title: finding.title })),
            explanation,
        };
    return {
        id: randomUUID(),
        scanId: input.assessment.scanId,
        repository: input.assessment.repository.fullName,
        mode: input.assessment.mode,
        scope: "local",
        status,
        createdAt: now,
        findingIds: input.findingIds,
        checks,
        comparison,
        remote: {
            ci: "not-run",
            pullRequest: "not-run",
            reason: "Local validation only. Remote CI and pull request evidence become available once a pull request is submitted to GitHub.",
        },
        limitations: [
            "Local validation only: proposed content was applied to an in-memory snapshot, not to a checkout of the repository.",
            "No dependency installation, build or test execution occurred.",
            "Validators cover file syntax and analysis-rule reproduction only; they cannot prove runtime behaviour.",
            input.assessment.mode === "demo"
                ? "This verification ran against a bundled demo fixture, not a live GitHub repository."
                : "This verification used the file set captured by the original live scan; changes pushed since then are not reflected.",
            ...(plan.unresolved.length > 0
                ? [`${plan.unresolved.length} finding(s) had no safe automatic remediation: ${plan.unresolved.map((entry) => entry.findingId).join(", ")}.`]
                : []),
        ],
        summary: status === "passed"
            ? `Local validation passed for ${patchProposals.length} patch proposal(s). Remote CI and pull request state are not available because nothing was pushed.`
            : status === "failed"
                ? "Local validation found at least one failure. Review the failed checks before submitting anything."
                : "Verification could not run a meaningful local validation for the current selection.",
    };
}
function electAutomatable(findings) {
    return findings.filter((finding) => finding.remediation.kind === "auto");
}

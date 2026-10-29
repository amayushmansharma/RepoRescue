import { unifiedDiff } from "../analysis/diff.js";
import { buildPullRequestDraft } from "../analysis/pr.js";
import { buildRemediationPlan } from "../analysis/remediations.js";
import { createZip } from "./zip.js";
function archiveSlug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70) || "repository";
}
/**
 * Regenerates the plan from the stored assessment instead of trusting any
 * client patch data, then exports only selected patch files and review assets.
 */
export function buildReviewExport(assessment, findingIds, now = new Date()) {
    const generatedAt = now.toISOString();
    const plan = buildRemediationPlan(assessment.snapshot, assessment.findings, findingIds, generatedAt);
    const patchProposals = plan.proposals.filter((proposal) => proposal.kind === "patch");
    if (patchProposals.length === 0 || plan.patchedFiles.length === 0) {
        throw new Error("No safe patch files are available for the selected findings.");
    }
    const findingsByPath = new Map();
    for (const proposal of patchProposals) {
        for (const file of proposal.files) {
            const assigned = findingsByPath.get(file.path) ?? [];
            assigned.push(proposal.findingId);
            findingsByPath.set(file.path, Array.from(new Set(assigned)).sort());
        }
    }
    const selectedProposals = patchProposals.map((proposal) => ({
        id: proposal.id,
        findingId: proposal.findingId,
        findingTitle: proposal.findingTitle,
        outcome: proposal.outcome,
        validation: proposal.validation,
        limitations: proposal.limitations,
        assumptions: proposal.assumptions,
    }));
    const draft = buildPullRequestDraft({
        snapshot: assessment.snapshot,
        findings: assessment.findings,
        proposals: plan.proposals,
        beforeScore: assessment.score.total,
    });
    const patchedByPath = new Map(plan.patchedFiles.map((file) => [file.path, file.content]));
    const files = plan.patchedFiles
        .map((file) => {
        const original = assessment.snapshot.files.find((source) => source.path === file.path)?.content ?? null;
        const proposalFile = patchProposals.flatMap((proposal) => proposal.files).find((candidate) => candidate.path === file.path);
        return {
            archivePath: `files/${file.path}`,
            repositoryPath: file.path,
            operation: proposalFile?.changeType ?? (original === null ? "create" : "modify"),
            content: patchedByPath.get(file.path) ?? file.content,
            findingIds: findingsByPath.get(file.path) ?? [],
            diff: unifiedDiff(file.path, original, patchedByPath.get(file.path) ?? file.content).diff,
        };
    })
        .sort((a, b) => a.repositoryPath.localeCompare(b.repositoryPath));
    const manifest = {
        format: "reborescue-review-export/v1",
        repository: assessment.repository.fullName,
        repositoryUrl: assessment.repository.url,
        scanId: assessment.scanId,
        mode: assessment.mode,
        generatedAt,
        boundary: "Preview export only. No repository was modified, no branch was pushed and no pull request was opened.",
        files: files.map(({ archivePath, repositoryPath, operation, findingIds }) => ({ archivePath, repositoryPath, operation, findingIds })),
        proposals: selectedProposals,
        prDraft: {
            title: draft.title,
            branch: draft.branch,
            baseBranch: draft.baseBranch,
            boundaryNote: draft.boundaryNote,
        },
    };
    const reviewText = `# RepoRescue review export

> **Preview only.** This archive contains proposed files generated from an evidence-backed assessment. Nothing in this archive was applied to GitHub, committed, pushed, or submitted as a pull request.

## Repository

- Repository: \`${assessment.repository.fullName}\`
- URL: ${assessment.repository.url}
- Scan ID: \`${assessment.scanId}\`
- Mode: **${assessment.mode.toUpperCase()}**${assessment.mode === "demo" ? " (bundled fixture, not GitHub)" : ""}
- Generated: ${generatedAt}
- Readiness score at scan: **${assessment.score.total}/100** (coverage ${assessment.score.coverage}/100)

## Contents

- \`files/\` contains the selected proposed file contents in repository-relative paths.
- \`proposed.patch\` is a unified patch over the exact scanned baseline.
- \`manifest.json\` links every file to its source finding(s) and includes validation evidence.
- \`REVIEW.md\` is this review guide and PR draft.

## Pull request draft (not submitted)

- Title: ${draft.title}
- Proposed branch: \`${draft.branch}\`
- Base branch: \`${draft.baseBranch}\`

${draft.description}

## Safe application guidance

1. Inspect every diff and the matching evidence in RepoRescue before applying anything.
2. Apply the files to a clean checkout of \`${assessment.repository.fullName}\`.
3. Run the repository's documented build and test commands yourself. RepoRescue did not run them.
4. Verify any runtime-version, CI trigger, contact, or license assumptions with maintainers.
5. Create your own branch and pull request only after this review. This export does not authorize a GitHub write.
`;
    const patch = files.map((file) => file.diff).join("\n\n");
    const bytes = createZip([
        ...files.map((file) => ({ path: file.archivePath, content: file.content })),
        { path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
        { path: "proposed.patch", content: `${patch}\n` },
        { path: "REVIEW.md", content: reviewText },
    ], now);
    return {
        bytes,
        filename: `reborescue-${archiveSlug(assessment.repository.fullName)}-${archiveSlug(assessment.scanId.slice(0, 8))}.zip`,
        manifest: {
            repository: assessment.repository.fullName,
            scanId: assessment.scanId,
            mode: assessment.mode,
            generatedAt,
            files: files.map(({ archivePath, repositoryPath, operation, findingIds }) => ({ archivePath, repositoryPath, operation, findingIds })),
        },
    };
}

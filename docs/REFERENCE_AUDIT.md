# RepoRescue reference audit and migration status

## Source availability

The requested source archive, `build-reporescue-web-app (9).zip`, and its stated `index.html` reference were **not present in the project workspace** during this rebuild. A filesystem search for ZIP files and RepoRescue source archives returned no results.

As a result, this document does **not** claim a line-by-line or pixel-for-pixel migration from an unavailable file. It records the migration baseline that was actually available: the existing working RepoRescue Next.js implementation and the visual/product requirements supplied with the task.

## Recoverable feature inventory

| Requested / existing product capability | Current implementation | API / service | Automated evidence |
| --- | --- | --- | --- |
| SCAN → FIND → FIX → REVIEW → VERIFY workflow | Five routed workspace stages, persistent selection and explicit stage navigation | Scan, remediation and verification services | API workflow test |
| Public GitHub scan | Read-only, allow-listed GitHub REST/raw client; bounded tree/files; optional server token | `github/client.ts` | Normalization and API tests; manual live scan documented in README |
| Offline demo | Two labelled deterministic fixtures use the same snapshot/rule engine as live scanning | `demo/fixtures.ts` | Engine + API tests |
| Evidence-backed findings | Stable rule ids, file/line evidence, confidence, categories, severity and validation method | `analysis/rules.ts` | Determinism, evidence and severity tests |
| Readiness score | Fixed 25/25/20/15/15 model, applicable coverage, deductions and documented formula | `analysis/score.ts` | Pinned fixture-score tests |
| Rule-based remediation | Selected findings regenerate safe patches with diffs and validation | `analysis/remediations.ts` | Patch determinism and validator tests |
| Diff-focused review | Unified diff viewer, manifest, PR draft and selected-file table | `analysis/diff.ts`, review UI | Diff and API workflow tests |
| Local ZIP review package | Server-generated ZIP of selected proposal contents, patch, manifest and review guide | `export/zip.ts`, `export/review-export.ts` | API export test validates ZIP signature, content paths and no server configuration leakage |
| Pull-request preview | Generated branch/title/body/checklist with explicit preview-only boundary | `analysis/pr.ts` | API workflow test |
| GitHub writes | Intentionally disabled by platform safety policy; no fake PR state | Health endpoint + review UI | API test asserts remote writes false |
| Verification | In-memory patched workspace re-analysis, score comparison, persisted record, explicit `not-run` remote states | `analysis/verify.ts` | Verification state and API tests |
| Tinted-glass UI | Charcoal foundation, selective lemon actions, lavender highlights, three glass tiers, Inter/JetBrains Mono and a responsive repository rail | `src/app/globals.css`, `reporescue/client/src/styles/global.css`, layout shells | Build/lint and stylesheet parity checks; the original ZIP was unavailable, so pixel-level comparison was not possible |

## Original-only capabilities that cannot be claimed as migrated

The task mentions source behaviours such as recorded walkthroughs, original license-decision handling, client-side secret redaction, GitHub write delivery, live CI polling, health-badge copying, and a possible built-in regression suite. Without the original `index.html`, their exact UI, logic and safety constraints cannot be audited or represented as preserved.

Safe, implemented equivalents currently available:

- Proposed fixes are explicitly review-only and have per-file validators.
- License selection is deliberately manual; RepoRescue will not choose legal terms.
- Environment file contents are not read or displayed; only suspicious committed file names are flagged.
- The review export contains no server environment configuration or credentials.
- Remote CI and pull-request statuses are reported as `not-run` because no GitHub write is ever performed.

## Architecture status (correction pass)

The required stack now exists in `reporescue/`: a React + Vite client written in JSX, a Node + Express API written in ES-module JavaScript, a pure-JavaScript analysis engine, and in-memory storage mirrored to bounded JSON files (no database). It was produced by stripping types from the audited TypeScript engine with `tsc` (logic unchanged, then re-tested) and hand-writing the Express layer, storage, router shell and the pages that were previously server-rendered.

The repository root still contains the sandbox's mandated Next.js + PostgreSQL application because the hosted preview in this environment can only run that template. It is retained only to keep the preview and its health check working; `reporescue/` is the deliverable for the brief.

Verified for `reporescue/` on the correction pass: `npm install` from the committed lockfile, `npm run lint` clean, `npm test` 24/24, `npm run build` succeeds, Express served the built client and the full demo workflow (scan → findings → preview → ZIP export → PR preview → 501 delivery → verification) over HTTP, the Vite dev proxy forwarded `/api`, a live scan of a public GitHub repository succeeded, and persisted scans survived a server restart.

## Re-audit procedure if the archive is supplied later

1. Extract the archive outside the running application.
2. Inspect the entire `index.html` (markup, styles, scripts and external links).
3. Map each real screen, action, rule, fixture, state transition and network operation to this document.
4. Diff visual tokens and user-facing copy against `src/app/globals.css` and React components.
5. Port any safe, actually implemented behaviour into a service plus a test.
6. Document any rejected original behaviour with its safety or platform reason.
7. Update README and this audit with the verified source version/date.

# RepoRescue

> ## ⚠️ Read first — two implementations live in this repository
>
> - **`reporescue/` — the required stack: React + Vite (JSX) client, Node + Express API, plain JavaScript, no database.**
>   This is the deliverable requested by the brief. Install and run it with `cd reporescue && npm install && npm run dev`.
>   Its own README (`reporescue/README.md`) documents commands, API, tests and limitations.
> - **Repository root — the sandbox's mandated Next.js + PostgreSQL template.** The hosted preview in this environment can
>   only run this Next.js app, so it is kept building and passing its health check. Both share the same analysis engine
>   logic (the Express version is the JavaScript port) and the same deterministic fixtures and pinned scores.
>
> The original reference archive `build-reporescue-web-app (9).zip` was **not present** in the workspace; see
> `docs/REFERENCE_AUDIT.md`. Please provide it so the UI can be audited against the real source.


**Open-source contribution readiness, with evidence instead of vibes.**

RepoRescue scans a repository, explains what blocks a first-time contributor, proposes reviewable patches, and verifies what actually changed. The product is a five-stage workflow:

```
SCAN → FIND → FIX → REVIEW → VERIFY
```

It is a working full-stack application, not a mockup: the UI calls real JSON REST endpoints, findings come from deterministic rules over real scanned evidence, patches are generated and syntax-validated on the server, review ZIPs are generated from the selected patch set, and verification records are persisted and retrievable by id.

> **Reference-source note:** the requested `build-reporescue-web-app (9).zip` / original `index.html` is not present in this workspace, so a byte-for-byte source audit was not possible. The implementation preserves the current product workflow and has been styled to the supplied dark tinted-glass visual directive (smoky charcoal-mauve outer frame, near-black inner panels, muted lavender-blush gradients, diffused ambient light); it does not claim a pixel-perfect reproduction of an image that was not delivered as an inspectable asset. See [`docs/REFERENCE_AUDIT.md`](docs/REFERENCE_AUDIT.md) for the auditable migration inventory and re-audit procedure.
>
> <h2>live link- https://reporescue1.onrender.com</h2>
---

## 1. What problem it solves

A valuable repository can still be impossible to start on:

- the README omits prerequisites, the install command or the tests;
- required environment variables appear only inside source files, with no committed template;
- there is no CI, so no contributor can prove a change builds;
- contribution guidance, issue templates and a code of conduct are missing;
- nobody knows which improvements are safe, small and reviewable.

RepoRescue turns that informal archaeology into an explainable workflow. Every finding cites evidence (file, line, excerpt). Every score deduction maps to a named check. Every unsupported fix is refused with manual instructions instead of guessed code.

**Who it is for:** maintainers prioritising onboarding work, beginner/intermediate contributors who need a first task with evidence, and hackathon judges who must distinguish implemented behaviour from simulation.


### Scan progress and workflow navigation

Both clients display only scan phases recorded by the server: `POST /api/scans` accepts a `progressId`, and `GET /api/scans/progress/:progressId` returns real phase updates. No percentage is fabricated. Errors show recovery guidance; a completed scan opens its assessment. The ticking elapsed-time display is excluded from the screen-reader live region.

A restrained 380 ms angled wipe runs only between workflow stages and is disabled by `prefers-reduced-motion`. No WebGL orb or decorative 3D animation is loaded.

---

## 2. Implemented workflow

| Stage | Route | What is real |
| --- | --- | --- |
| **SCAN** | `/scan/:scanId` | Normalized input validation, live GitHub retrieval or bundled fixture, ecosystem detection, 21 checks, weighted score, limitations and next steps. |
| **FIND** | `/scan/:scanId/findings` | Search, severity/category filters, sorting, expandable evidence with file + line, confidence (confirmed vs needs-review), remediation route, selection state. |
| **FIX** | `/scan/:scanId/fix` | Server-generated patches for supported findings, unified diffs, per-file validation, assumptions/limitations, manual recommendations for the rest. Selection is revisable. |
| **REVIEW** | `/scan/:scanId/review` | Complete diff set, changed-file table, validation evidence, generated branch/title/description, PR checklist, explicit "no write performed" boundary. |
| **VERIFY** | `/scan/:scanId/verify` | Recorded local verification: patch consistency, file validators, rule re-evaluation against the patched workspace, before/after score, resolved / remaining / newly detected findings, and honest `not run` states for CI and pull requests. |

Cross-cutting behaviour: loading states, empty states, structured API errors with recovery guidance, keyboard-accessible disclosure and forms, visible focus rings, reduced-motion support, responsive layout.

---

## 3. Technology

**Stack note.** The target environment for this build is a managed Next.js + PostgreSQL sandbox, so the application is implemented as a Next.js (App Router) full-stack app instead of a Vite/Express/MongoDB split. The architecture the brief asked for is preserved:

- **Frontend:** React 19 client components, modular feature folders, no privileged logic in the browser.
- **Backend:** Next.js route handlers under `src/app/api/**` acting as the Express-equivalent REST layer. Route handlers are thin; all business logic lives in `src/server/**` services. Handlers are directly importable and are tested without opening a network port.
- **Persistence:** PostgreSQL via Drizzle ORM (`scans`, `verifications`). Storage is isolated behind `src/server/store/scan-store.ts` with an explicit in-process fallback that is surfaced in the UI and API instead of failing silently.
- **Validation/parsing:** hand-written request validation (typed errors, 64 KB body cap), `yaml` for YAML validation.
- **Tests:** Node's built-in test runner with `tsx` (unit + API integration, 23 tests).
- **Styling:** Tailwind CSS v4 utilities plus a small semantic CSS design system in `globals.css` (dark glassmorphism).

No LLM, no paid service, no external API is required for the demo.

### Directory structure

```
src/
  app/
    page.tsx                        overview + scan launcher + recent scans
    methodology/page.tsx            score formula, live rule catalogue, API + security notes
    scans/page.tsx                  persisted scan history
    scan/[scanId]/
      layout.tsx                    workspace provider + five-stage navigation
      page.tsx  findings/  fix/  review/  verify/
    api/
      health/route.ts
      demo-repositories/route.ts
      scans/route.ts                POST create scan, GET history
      scans/[scanId]/{route,findings/route,score/route,rescan/route}.ts
      remediations/{preview,validate}/route.ts
      pull-requests/preview/route.ts
      verifications/route.ts  verifications/[verificationId]/route.ts
  components/                       shell + UI kit (score ring, diff viewer, badges)
  features/                         scan launcher, findings explorer, fix/review/verify workspaces
  lib/                              shared contracts, API client, scoring text
  server/
    analysis/                       normalize, snapshot, rules, score, diff, validators,
                                    remediations, pr, verify, text helpers
    demo/fixtures.ts                deterministic bundled repositories
    github/client.ts                bounded, read-only GitHub retrieval
    services/                       scan, remediation, findings orchestration
    store/scan-store.ts             Drizzle persistence + documented fallback
    http/                           errors, JSON rules, rate limiting, selection parsing
  db/                               Drizzle client + schema
tests/                              normalize, engine, patch, API workflow tests
```

---

## 4. Prerequisites

- Node.js 20+ (verified on Node 22)
- npm 10+
- PostgreSQL 14+ (a local instance is expected; `DATABASE_URL` is read from `.env`)

No Docker, no GitHub credentials, and no paid services are required.

---

## 5. Installation and startup

```bash
npm install
cp .env.example .env          # set DATABASE_URL for your local Postgres
npx drizzle-kit push          # create the scans/verifications tables
npm run dev                   # http://localhost:3000
```

Production build and start:

```bash
npm run build
npm run start
```

### Commands (all verified during development)

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm test` | Node test runner: unit + API integration (23 tests) |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npx drizzle-kit push` | Apply the Drizzle schema to PostgreSQL |

---

## 6. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes for persistence | PostgreSQL connection string. Without it (or if unreachable) scans are held in-process and the API/UI labels that storage mode. |
| `GITHUB_TOKEN` | Optional | Server-only token used for live scans of public repositories (raises the GitHub rate limit; not needed for demo mode). Never sent to the browser. |
| `FRAME_ANCESTORS` | Optional | CSP `frame-ancestors` value. Unset by default so hosted previews can embed the app in an iframe. Set to `'none'` to deny all embedding (also sends `X-Frame-Options: DENY`) or to a list such as `'self' https://trusted.example`. |
| `NODE_ENV` | Set by Next.js | Build/runtime mode. |

`.env.example` contains placeholders only. Never commit real credentials. RepoRescue does not read tokens from the client, localStorage or URLs.

---

## 7. Demo mode (no credentials)

Two bundled fixtures (`src/server/demo/fixtures.ts`) run through **the same** analysis, remediation and verification services as a live scan:

- **`beacon-labs/beacon-api`** (TypeScript): README without prerequisites, three required env vars documented nowhere, no CI, no tests, no contribution guide, no license. Scores **47/100** with 10 findings; 6 have safe patches.
- **`tidewatch-labs/tidewatch`** (Python): a healthy repository with a missing env template and missing conduct/PR templates. Scores **85/100**; 3 fixes take it to **100**.

Both are deterministic: the same fixture and the same selection always produce the same findings, diffs, validations and scores. Fixture results are labelled `DEMO · FIXTURE` everywhere. A demo run never contacts GitHub and never claims to be a live scan.

A full demo pass: open `/`, click **Beacon API**, inspect the score breakdown, review findings, select fixes, read the diffs, review the PR draft, then run verification and inspect the before/after comparison (47 → 84, 6 resolved, 4 manual findings remaining, CI and PR explicitly `not run`).

---

## 8. Live scanning

Enter `https://github.com/owner/repo`, `github.com/owner/repo`, `git@github.com:owner/repo.git` or `owner/repo`.

Read-only retrieval:

1. `GET /repos/{owner}/{repo}` for metadata (description, topics, license, stars, default branch).
2. `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` for a bounded file listing.
3. `raw.githubusercontent.com` for at most **24** files (≤160 KB each, ≤900 KB total), chosen by priority: README, LICENSE, CONTRIBUTING, code of conduct, manifests, lockfiles, `.gitignore`, `.env` templates, CI workflows, PR template, then representative source files for environment-variable detection.

Safeguards: 9-second timeout per request, validated payload shapes, no execution, no installs, no shell interpolation, no writes, no recursion into `.git`, explicit limitations for truncation/partial data. 404, forbidden, unauthorized, rate-limited (with retry guidance), timeout and unavailable states map to distinct error codes.

---

## 9. Analysis rules and scoring

21 checks across five weighted dimensions (weights sum to 100):

| Dimension | Weight | Checks |
| --- | --- | --- |
| Documentation & onboarding | 25 | README present (8), install instructions (6), prerequisites (5), usage/run instructions (6) |
| Reproducible setup | 25 | manifest present (6), lockfile committed (7), env vars documented (7), template covers every key (5) |
| Testing & CI | 20 | tests detected (7), test command documented (5), CI workflow (5), CI runs tests (3) |
| Contribution guidance | 15 | CONTRIBUTING (6), code of conduct (3), issue/PR templates (4), workflow documented (2) |
| Configuration & hygiene | 15 | license file (5), manifest license (2), `.gitignore` (3), repo description/topics (2), no committed env files (3) |

Ecosystems detected from root manifests: JavaScript/TypeScript, Python, Java/JVM, Go, Rust. Package managers (npm/pnpm/yarn/bun, poetry/pip/uv) and test commands are derived from lockfiles, manifests and config.

**Formula**

```
total = round(100 × Σ earned / Σ applicable weight)
dimension = round(100 × Σ earned_in_dimension / Σ applicable_weight_in_dimension)
partial credit = 50% of a check's weight
not-applicable checks are excluded from both sums; coverage = Σ applicable weight
```

**Honesty rules**

- Every deduction lists its check id, points and evidence.
- Missing evidence is treated as a documentation/setup gap, never as proof that code is bad.
- Ordinary documentation gaps are never labelled critical. `critical` is reserved for future concrete security findings; no currently implemented rule emits it.
- `confirmed` findings cite file/line evidence; `needs-review` findings (for example a committed `.env` file read by name only) require human confirmation.
- The score is not a quality, security or maintainability rating and never changes weights silently.

`/methodology` renders this catalogue straight from the deployed rule engine.

---

## 10. Remediation, review and verification

**Automatic remediation rules** (deterministic templates, 13 supported rule ids): environment template creation/completion, CI workflow scaffold, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue + PR templates, `.gitignore`, README requirements/getting-started/usage/test sections, contribution dev-setup section, `package.json` license field when an SPDX license is already committed, and `package.json` engines when a runtime is proposed.

**Never automated:** choosing a license, rotating or inspecting committed secrets, inventing a test suite, rewriting an existing CI workflow, changing repository settings.

Every patch includes: the finding addressed, intended outcome, affected file, original content, proposed content, unified diff, validation results, assumptions, limitations and pre-submission instructions. Validation covers JSON syntax, YAML syntax, GitHub Actions structure, markdown structure (including balanced fences), env-template key format, `.gitignore` patterns and patch path safety. Validators that do not apply are reported as `skipped`/`unavailable`, never as passed.

**Review ZIP export:** REVIEW can download a server-generated archive for the current selection. It contains only `files/<repository path>` proposed contents, `proposed.patch`, `manifest.json` (finding and validation linkage), and `REVIEW.md` (the PR draft and safe-application guidance). The archive is size-bounded, path-validated, contains no secrets or server environment values, and never creates a branch, commit, or pull request.

**Verification scope:** the selected patches are applied to an in-memory copy of the scanned snapshot, the full rule set is re-run, the score is recalculated, and resolved/remaining/newly-detected findings are recorded and persisted. Reportable states: `passed`, `failed`, `partial`, `unavailable`, `skipped`, `not-run`. Repository code is never executed, dependencies are never installed, and remote CI/PR/merge states are always `not run` because nothing is pushed.

**Remote writes are disabled by design in this build.** No branch, commit, push, pull request, review or merge is performed, and no PR number/URL is ever invented.

---

## 11. REST API

All responses use `{ "ok": true, "data": … }` or `{ "ok": false, "error": { code, message, details? } }`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Service, storage, credential mode, write policy (always 200 with honest checks) |
| GET | `/api/demo-repositories` | Bundled fixtures |
| POST | `/api/scans` | `{ demoId }` or `{ repository }`; 201 with client-safe assessment |
| GET | `/api/scans` | Recent history |
| GET | `/api/scans/:scanId` | Assessment without repository file bodies |
| GET | `/api/scans/:scanId/findings` | `severity`, `category`, `q`, `sort`, `fixable` |
| GET | `/api/scans/:scanId/score` | Dimensions, deductions, formula, limitations |
| POST | `/api/scans/:scanId/rescan` | Fresh evidence in a new scan record |
| POST | `/api/scans/:scanId/export` | `{ findingIds }` → binary ZIP with selected proposed contents, `proposed.patch`, `manifest.json`, and `REVIEW.md` |
| POST | `/api/remediations/preview` | `{ scanId, findingIds }` → proposals, diffs, validation |
| POST | `/api/remediations/validate` | Server-regenerated patches only; client patches are never trusted |
| POST | `/api/pull-requests/preview` | `{ scanId, findingIds, verificationId? }` → draft, checklist, boundary |
| POST | `/api/verifications` | Records local verification; 201 |
| GET | `/api/verifications/:verificationId` | Retrieves the recorded evidence |

Error codes: `INVALID_INPUT`, `INVALID_REPOSITORY`, `NOT_FOUND`, `RATE_LIMITED`, `REPOSITORY_NOT_FOUND`, `REPOSITORY_FORBIDDEN`, `GITHUB_UNAUTHORIZED`, `GITHUB_RATE_LIMITED`, `GITHUB_UNAVAILABLE`, `GITHUB_TIMEOUT`, `UPSTREAM_ERROR`, `PAYLOAD_TOO_LARGE`, `STORAGE_UNAVAILABLE`, `INTERNAL_ERROR`. Internal stack traces are logged server-side only, never returned.

---

## 12. Security model

- Explicit request validation; JSON content-type required; 64 KB body cap; bounded arrays/strings.
- Server-side authority: scores, patches, validations and verification states are always recomputed server-side from the stored scan.
- Fixed-window rate limits per client on scan creation (12/min), rescans (6/min), previews (40/min) and verification (20/min).
- Security headers on all routes: CSP (no third-party script/style/connect origins), `nosniff`, strict referrer policy, permissions policy. Frame embedding is allowed by default so the hosted preview works; set `FRAME_ANCESTORS="'none'"` (or an allow-list) to lock it down for a production deployment.
- No permissive CORS: the API is same-origin only.
- Repository content is untrusted input: no execution, no installs, no shell interpolation, path-traversal rejection, file-count/size/path limits, binary skipping.
- GitHub credentials are read only from `process.env` on the server and are never included in responses or logs.
- Committed `.env` files are detected by name only; contents are never read or displayed.

---

## 13. Tests

`npm test` — **23 tests, 23 passing** (Node test runner + `tsx`), covering:

- repository input normalization, rejection of unsupported/unsafe input, path-safety;
- deterministic rule evaluation, severity non-inflation, empty-repository behaviour;
- pinned fixture scores (beacon 47/85 coverage, tidewatch 85) and dimension weights;
- diff generation (create/modify/no-op) and unified-diff parsing;
- validators (JSON/YAML/markdown/env/gitignore, skipped-vs-failed);
- remediation plan composition, multi-file proposals, manual-only findings, determinism;
- verification transitions, before/after comparison, `not-run` remote states, unavailable path;
- API integration: health, demo listing, scan creation, invalid input, unsupported repository, unknown scan, findings filtering, score, preview, validate, PR preview, verification create/retrieve, unknown-selection and mismatched-verification rejections.

Not tested automatically: browser UI end-to-end flows (no headless browser is installed in this environment), live GitHub network paths (external calls are avoided in tests), and Postgres-specific persistence behaviour beyond the API workflow tests (the store falls back to in-process storage when the database is unreachable).

---

## 14. Known limitations

- Live scanning only covers the default branch, a bounded file set and static file analysis; it cannot prove a project builds or that its tests pass.
- Rules are heuristic by design (for example "install command present" via command patterns); evidence is shown so a human can disagree.
- Generated remediation text and runtime versions are proposals that need maintainer review.
- The in-process storage fallback is lost on restart; PostgreSQL is the durable path.
- Rate limiting is per-process, not distributed.
- No accounts, no saved workspaces, no live PR creation, no judge-facing analytics — none of these are advertised as available.

---

## 15. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| API returns `STORAGE_UNAVAILABLE` / UI shows "in-process storage" | PostgreSQL unreachable or tables missing. Check `DATABASE_URL`, run `npx drizzle-kit push`, verify `/api/health`. |
| `REPOSITORY_NOT_FOUND` | Private/renamed repository, or typo. Only public repositories are supported without a token. |
| `GITHUB_RATE_LIMITED` | Anonymous GitHub limit (60 requests/hour). Wait for the stated retry window, set a server-side `GITHUB_TOKEN`, or use demo mode. |
| `GITHUB_TIMEOUT` | GitHub did not answer within 9 seconds. Retry; large repositories may need a smaller target. |
| Scan loads but fixes are `manual` | The finding has no safe deterministic remediation. Read the listed human steps. |
| Verification says `unavailable` | Only manual findings were selected, so no patched workspace could be produced. |
| Port 3000 already in use | `npm run dev -- -p 3001`. |
| Preview iframe is blank / shows a broken-page icon | The deployment is sending `frame-ancestors 'none'`. Unset `FRAME_ANCESTORS` (default) or add the embedding origin to it. |

---

## 16. Build-time boundary confirmation

During this implementation: no deployment, no `git push`, no branch/commit creation, no pull request, review or merge, and no external GitHub write of any kind was performed. All GitHub access implemented by the product is read-only and optional. The database schema was applied locally with `drizzle-kit push`.

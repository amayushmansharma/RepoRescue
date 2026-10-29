# RepoRescue (React + Vite · Node + Express · JavaScript)

**Open-source contribution readiness, with evidence instead of vibes.**

RepoRescue scans a GitHub repository, explains what blocks a first-time contributor, proposes reviewable patches, packages them for review, and verifies what actually changed — without ever writing to GitHub.

```
SCAN → FIND → FIX → REVIEW → VERIFY
```

> **Reference-source note.** The requested original archive `build-reporescue-web-app (9).zip` / `index.html` was **not available** in the build environment (a full filesystem search found no archive). This implementation migrates the working RepoRescue engine and five-stage workflow into the required stack and implements the supplied tinted-glass visual directive: a smoky charcoal-mauve outer app frame, near-black inner panels, muted lavender→blush gradient accents, diffused ambient blooms, pill-shaped controls and generous radii, with Inter for text and JetBrains Mono for technical values. It does **not** claim pixel-level fidelity to a file it could not inspect. **Please supply the ZIP** and the UI can be audited and aligned screen by screen; see `../docs/REFERENCE_AUDIT.md`.

---

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 7, JavaScript + JSX, React Router 7, Tailwind utilities + a hand-written design-token stylesheet |
| Backend | Node.js 20+, Express 5, ES modules, REST/JSON |
| Analysis engine | Pure JavaScript modules in `server/src/analysis` (no framework or HTTP dependency) |
| Storage | In-memory map mirrored to bounded JSON files (`server/data/`). **No database required.** |
| Tests | Node's built-in test runner (`node --test`): 15 unit + 9 integration tests |
| Lint | ESLint 9 flat config (`@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`) |

No AI model, no paid service and no credentials are needed for the demo workflow.

## Project structure

```
reporescue/
├── client/                      React + Vite (JSX)
│   ├── index.html
│   ├── vite.config.js           /api → Express proxy in dev
│   └── src/
│       ├── main.jsx  App.jsx    router, shell, footer
│       ├── pages/               OverviewPage, ScanPage, FindingsPage, FixesPage,
│       │                        ReviewPage, VerifyPage, MethodologyPage, ScanHistoryPage
│       ├── components/          ui.jsx (score ring, diff viewer, badges…), layout/, repository/
│       ├── state/               ScanWorkspaceProvider.jsx (selection + verification state)
│       ├── services/            api-client.js (fetch wrapper, typed errors, ZIP download)
│       └── styles/global.css    design tokens + component styles
├── server/                      Node + Express
│   └── src/
│       ├── server.js            entry (binds port)
│       ├── app.js               createApp(): middleware, routers, static client, error handler
│       ├── config/env.js        .env loading + validation (never echoes secrets)
│       ├── routes/              scans.js, remediations.js (remediation/PR/verification), system.js
│       ├── middleware/          rate-limit.js
│       ├── http/errors.js       ApiError, JSON envelope, request validation
│       ├── analysis/            normalize, snapshot, rules, score, diff, validators,
│       │                        remediations, pr, verify, text
│       ├── github/client.js     bounded read-only GitHub retrieval
│       ├── export/              zip.js, review-export.js
│       ├── services/            scan-service, remediation-service, findings-service
│       ├── demo/fixtures.js     deterministic bundled repositories
│       └── storage/scan-store.js
├── shared/                      constants.js (severities, labels, weights), scoring-text.js
├── tests/
│   ├── unit/                    normalize, engine, patch
│   └── integration/api.test.js  Express app on an ephemeral port
├── package.json                 npm workspaces + root scripts
├── package-lock.json            committed lockfile
├── eslint.config.js  .env.example  .gitignore
```

## Prerequisites

- Node.js **20.11+** (verified on 22.x)
- npm 10+
- Internet access only for live GitHub scans and `npm install`

## Install and run

```bash
cd reporescue
npm install                      # installs client + server workspaces from the committed lockfile
cp .env.example .env             # optional; defaults work out of the box

npm run dev                      # Express API on :3001 + Vite client on :5173 (proxying /api)
#   open http://localhost:5173
```

Production build and single-process start (Express serves `client/dist` and the API from one origin):

```bash
npm run build                    # vite build → client/dist
npm start                        # http://localhost:3001
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (`node --watch`) + Vite dev server concurrently |
| `npm run dev:server` / `npm run dev:client` | Either side alone |
| `npm run build` | Production client bundle |
| `npm start` | Express serving API + built client |
| `npm test` | Unit + integration tests (`node --test`) |
| `npm run test:unit` / `npm run test:integration` | Subsets |
| `npm run lint` | ESLint across client, server, shared, tests |
| `npm run verify` | lint → test → build |

## Environment variables (`.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Express port |
| `HOST` | `0.0.0.0` | Bind address |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Only needed for cross-origin deployments; exactly one origin, never a wildcard |
| `GITHUB_TOKEN` | empty | Optional **server-side** token for live scans (higher rate limit). Never sent to the browser or logged. |
| `REPORESCUE_PERSIST` | `true` | `false` keeps scans in memory only |
| `REPORESCUE_DATA_DIR` | `./server/data` | JSON mirror location |
| `FRAME_ANCESTORS` | empty | CSP `frame-ancestors`; `'none'` also sends `X-Frame-Options: DENY` |
| `TRUST_PROXY` | `false` | Honour `X-Forwarded-For` for rate-limit keys behind a trusted proxy |

## Demo workflow (no credentials)

1. Open the overview and click **Beacon API (TypeScript)** — a bundled, deterministic fixture clearly labelled `DEMO · FIXTURE`.
2. **SCAN** shows score **47/100** (coverage 85), 10 findings, dimension breakdown, deductions and limitations.
3. **FIND** — search, filter by severity/category, sort, expand evidence (file + line), select findings.
4. **FIX** — 6 rule-based patch proposals across 8 files, each with a unified diff, validators (JSON/YAML/workflow/markdown/env/gitignore), assumptions and limitations; 4 findings are manual-only with explicit steps.
5. **REVIEW** — changed-file manifest, full diff set, validation summary, PR draft (title/branch/description/checklist), **Copy** controls and **Download review ZIP**. The preview boundary states that nothing was written to GitHub.
6. **VERIFY** — records a local re-analysis of the patched in-memory workspace: 47 → 84, 6 resolved, 4 remaining, 0 newly detected; remote CI and PR state are `not-run`.
7. The second fixture (**Tidewatch**, Python) shows a healthy repository: 85 → 100 after 3 fixes.

The same engine runs for live scans: paste `owner/repo` or a `github.com` URL.


### Scan progress and stage navigation

During a scan, the launcher displays a restrained phase list and elapsed time. `POST /api/scans` accepts a client-generated `progressId`; `GET /api/scans/progress/:progressId` returns only phases the server actually performed. The UI does not invent a completion percentage. A failed scan shows the API error with recovery guidance; a completed scan opens its assessment. Only the phase title is announced to assistive technology, so the ticking clock does not repeat in a live region.

Major workflow navigation uses a 380 ms angled charcoal/lavender wipe. It never blocks pointer or keyboard input and is disabled under `prefers-reduced-motion`. No WebGL orb or decorative 3D animation is loaded.

## REST API

All JSON endpoints answer `{ ok: true, data }` or `{ ok: false, error: { code, message, details?, retryAfterSeconds? } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Storage mode, GitHub credential mode, write policy |
| GET | `/api/config/capabilities` | Feature availability, scoring model, live rule catalogue, API list |
| GET | `/api/demo-repositories` | Bundled fixtures |
| POST | `/api/scans` | `{ demoId }` or `{ repository }` → 201 assessment (no file bodies) |
| GET | `/api/scans` | Recent history |
| GET | `/api/scans/:scanId` | Assessment |
| GET | `/api/scans/:scanId/findings` | `severity`, `category`, `q`, `sort`, `fixable` |
| GET | `/api/scans/:scanId/score` | Dimensions, deductions, formula, limitations |
| GET | `/api/scans/:scanId/report` | Assessment + score |
| POST | `/api/scans/:scanId/rescan` | Fresh evidence as a new scan |
| POST | `/api/scans/:scanId/export` | `{ findingIds }` → `application/zip` |
| POST | `/api/remediations/preview` | `{ scanId, findingIds }` → proposals, diffs, validation |
| POST | `/api/remediations/validate` | Server-side validation of regenerated patches |
| POST | `/api/pull-requests/preview` | PR draft + checklist (`performedRemoteWrites: false`) |
| POST | `/api/pull-requests` | **Always 501 `NOT_CONFIGURED`** — remote delivery is disabled in this build |
| POST | `/api/verifications` | Record a local verification (201) |
| GET | `/api/verifications/:id` | Retrieve a verification |

Error codes: `INVALID_INPUT`, `INVALID_REPOSITORY`, `NOT_FOUND`, `RATE_LIMITED`, `REPOSITORY_NOT_FOUND`, `REPOSITORY_FORBIDDEN`, `GITHUB_UNAUTHORIZED`, `GITHUB_RATE_LIMITED`, `GITHUB_UNAVAILABLE`, `GITHUB_TIMEOUT`, `UPSTREAM_ERROR`, `PAYLOAD_TOO_LARGE`, `NO_REMEDIATION`, `NOT_CONFIGURED`, `INTERNAL_ERROR`.

## Analysis rules and scoring

21 deterministic checks in five dimensions (weights sum to 100): documentation 25 · setup 25 · testing/CI 20 · contribution 15 · hygiene 15. Ecosystems detected from root manifests: JS/TS, Python, Java, Go, Rust.

```
total     = round(100 × Σ earned / Σ applicable weight)
dimension = round(100 × Σ earned_in_dimension / Σ applicable_weight_in_dimension)
partial   = 50 % of a check's weight; not-applicable checks leave both sums
coverage  = Σ applicable weight (always shown beside the total)
```

Every deduction names its check, points and evidence. `/methodology` renders the catalogue straight from the running engine. Missing evidence is treated as an onboarding gap, never as proof that code is bad; no implemented rule emits `critical`.

## Remediation, review, export, verification

- **13 automatic remediation rules** (env template create/complete, CI scaffold, CONTRIBUTING, code of conduct, issue/PR templates, `.gitignore`, README requirements/getting-started/usage/tests sections, contributing dev-setup, manifest license when an SPDX file exists, engines field). Everything else — license choice, committed secrets, inventing tests, editing an existing workflow, repository settings — is manual with explicit steps.
- Validators: JSON, YAML, GitHub Actions structure, markdown (balanced fences, headings), env-template keys, `.gitignore` patterns, patch-path safety. Non-applicable validators report `skipped`, never `passed`.
- **ZIP export** (`server/src/export`): dependency-free archive writer; includes `files/<repo path>`, `proposed.patch`, `manifest.json`, `REVIEW.md`; path-validated, size-bounded, no secrets or server configuration.
- **Verification** re-runs all rules against an in-memory patched snapshot and persists a record with `passed | failed | partial | unavailable` plus per-check `passed | failed | skipped | not-run`. CI and PR state are always `not-run` because nothing is pushed.

## Security model

- GitHub token server-side only; never in Vite env, responses, logs or exports.
- Only `github.com` repositories are accepted; the API origin is fixed; no generic proxy.
- Path traversal, absolute paths, NUL bytes and `.git/` are rejected for every repository and patch path.
- Repository content is untrusted: no execution, no installs, no shell interpolation, bounded downloads (≤24 files / ≤160 KB each / ≤900 KB total), binary files skipped.
- Request validation with 64 KB JSON limit; per-client fixed-window rate limits on scan (12/min), rescan (6/min), previews (40/min), export (20/min), verification (20/min).
- Security headers on every response (CSP, nosniff, referrer policy, permissions policy); no `X-Powered-By`; same-origin API by default.
- Scanning is read-only. **Remote GitHub writes are not implemented** and `POST /api/pull-requests` returns 501 instead of pretending.

## Tests (executed)

```
npm test     → 38 tests, 38 passed, 0 failed
```

- Unit: repository input normalization and rejection, path safety, deterministic rule evaluation, pinned fixture scores (47/85 coverage; 85), empty-repository behaviour, diff generation/parsing, validators, remediation plan composition and determinism, verification transitions and `unavailable` path.
- Integration (Express on an ephemeral port): health/capabilities, security headers, demo listing, demo scan, invalid input (bad demo id, non-GitHub host, wrong content-type, malformed JSON, >64 KB body → 413), unknown ids/routes, findings filters, score/report/history, preview → validate → **ZIP export** → PR preview → delivery 501 → verification → retrieval → PR draft with recorded evidence, selection rejections.

Browser regression coverage is now available in `tests/browser/smoothness.js`: **29 checks passed in headless Chromium** against the production Vite client and real Express API, including all five stages, responsive widths, keyboard interactions, native scrolling, copy/ZIP export, delayed/error responses, and reduced motion. See [docs/SMOOTHNESS_QA.md](docs/SMOOTHNESS_QA.md) for exact commands and limitations. Browser tooling is installed temporarily, not added to the app dependencies. Safari/Firefox and real mobile hardware remain unverified; layered-glass colour contrast needs manual review. Live GitHub network paths were not re-run during this UI-only pass.

## Known limitations

- Live scanning analyses the default branch and a bounded file set statically; it cannot prove a project builds or tests pass.
- Generated text/runtime versions are proposals for maintainer review.
- JSON persistence is single-process and bounded to 50 scans / 200 verifications; rate limiting is per process.
- No accounts, no live PR creation, no CI polling, no AI features — none are advertised as available.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Overview shows "API unavailable" | Start the server (`npm run dev:server`) or check `PORT`; the Vite proxy targets `http://localhost:3001` (override with `VITE_DEV_API_TARGET`). |
| `GITHUB_RATE_LIMITED` | Anonymous GitHub limit (60/h). Wait, set a server-side `GITHUB_TOKEN`, or use demo mode. |
| `REPOSITORY_NOT_FOUND` | Private/renamed repository or typo. |
| Verification says `unavailable` | Only manual findings were selected; nothing could be patched locally. |
| Blank page inside an iframe | Set/unset `FRAME_ANCESTORS` to allow the embedding origin. |
| Port in use | `PORT=3101 npm run dev:server` and `VITE_DEV_API_TARGET=http://localhost:3101 npm run dev:client`. |

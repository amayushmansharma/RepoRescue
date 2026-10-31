# RepoRescue

**Find problems. Understand them. Fix them. Help developers contribute better.**

### Hackathon Metadata
- **Project**: RepoRescue
- **Team**: COGNIVANCE
- **Event**: DevForge Hacktoberfest 2026
- **Team Members**:
  - Ayushman Sharma
  - Shreyas Gondkar
  - Devansh Bansal
- **Pitch Deck**: 7-slide Hackathon Presentation ([RepoRescue — Hackathon Pitch](./RepoRescue.pptx))

---

RepoRescue is an intelligent, open-source repository health and contribution assistant. It scans a GitHub repository's real evidence — README, dependency manifests, lockfiles, CI workflows, contribution guides, issue/PR templates, and environment usage — runs 21 deterministic checks across five weighted scoring dimensions, identifies prioritized contribution opportunities, generates reviewable patches with unified diffs, provides optional AI-assisted finding explanations via Gemini Flash, and equips contributors with a complete pre-submission playbook, exportable packages, and safe 1-click fork-based pull request delivery — all with defense-in-depth token security.

```
DISCOVER → SCAN → UNDERSTAND → FIND OPPORTUNITIES → FIX → REVIEW → VERIFY → PR / EXPORT
```

---

## What RepoRescue Does

1. **Deterministic Repository Health Analysis**: Evaluates repositories against 21 evidence-backed checks across 5 weighted dimensions (Documentation, Setup, Testing & CI, Contribution Guidance, Hygiene). Scores are computed strictly from verifiable file evidence with an audited formula.
2. **AI-Powered Finding Explanations (Optional Gemini Flash)**: Explains what was discovered, why maintainers care, who is affected, and actionable steps in plain developer language. Grounded strictly in scanned repository evidence with untrusted-data boundary delimiters. Transparently falls back to deterministic analysis if an API key is not configured.
3. **Contribution Opportunity Engine**: Transforms raw scanner findings into prioritized, actionable contribution opportunities for developers. Highlights beginner-friendly ("good first issue") tasks, potential readiness impact, relevant files, and difficulty estimates.
4. **Automated & Validated Remediation**: 13 rule-based remediation builders generate syntax-validated unified diffs for common repository gaps (environment templates, CI scaffolding, README setup guides, `.gitignore`, templates, licensing metadata). Unsupported or security-sensitive findings are marked manual-only with explicit instructions.
5. **Review Workspace & Contributor Playbook**: Full file diff viewer, pre-submission checklist, draft PR title & description, one-click clipboard controls, unified `.patch` export, and zero-dependency ZIP archive export.
6. **Local In-Memory Verification**: Re-evaluates analysis rules against the in-memory patched workspace to demonstrate score deltas (e.g. Beacon API 47 → 84) while explicitly reporting that remote CI and PR delivery remain `not-run`.

---

## Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, Vite 7, JavaScript + JSX, React Router 7, Tailwind utilities + custom design-token stylesheet |
| **Backend** | Node.js 20+, Express 5, ES modules, REST/JSON |
| **AI Provider** | Google Gemini Flash (`gemini-2.0-flash`) via native REST `fetch` (server-side only, optional) |
| **Analysis Engine** | Pure JavaScript modules in `server/src/analysis` (no framework or database dependency) |
| **Storage** | In-memory map mirrored to bounded JSON files (`server/data/`). **No database required.** |
| **Tests** | Node's built-in test runner (`node --test`): 109 tests (unit + integration), 0 external test runners |
| **Lint** | ESLint 9 flat config (`@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`) |
| **Workflow** | One-Click Fork-based Pull Request creation with server-side token security |

---

## Project Structure

```
reporescue/
├── client/                      React + Vite (JSX)
│   ├── index.html
│   ├── vite.config.js           /api → Express proxy in dev
│   └── src/
│       ├── main.jsx  App.jsx    Router, shell, footer, navigation
│       ├── pages/               OverviewPage, ScanPage, FindingsPage, FixesPage,
│       │                        ReviewPage, VerifyPage, MethodologyPage, ScanHistoryPage
│       ├── components/          ui.jsx (score ring, diff viewer, badges…), layout/, repository/
│       ├── state/               ScanWorkspaceProvider.jsx, useWorkspaceResource.js
│       ├── services/            api-client.js (fetch wrapper, typed errors, ZIP download)
│       └── styles/global.css    Design tokens + component styles
├── server/                      Node + Express
│   └── src/
│       ├── server.js            Entry point (binds port)
│       ├── app.js               createApp(): security headers, routers, static client, error handler
│       ├── config/env.js        Environment variable loader
│       ├── routes/              scans.js, remediations.js, auth.js, system.js
│       ├── middleware/          rate-limit.js
│       ├── http/errors.js       ApiError, JSON envelope, validation
│       ├── ai/                  gemini.js (REST client), explain-finding.js (grounded explanations)
│       ├── analysis/            normalize, snapshot, rules, score, opportunities, diff,
│       │                        validators, remediations, pr, verify, text
│       ├── github/client.js     Bounded read-only GitHub retrieval
│       ├── export/              zip.js, review-export.js
│       ├── services/            scan-service, remediation-service, findings-service
│       ├── demo/fixtures.js     Deterministic bundled repositories (Beacon API, Tidewatch)
│       └── storage/scan-store.js
├── shared/                      constants.js (severities, labels, weights), scoring-text.js
├── tests/
│   ├── unit/                    engine, normalize, patch, progress, ai-explain, opportunities
│   └── integration/api.test.js  Express API test suite on ephemeral ports
├── package.json                 npm workspaces + root scripts
├── package-lock.json            Committed lockfile
├── LICENSE                      MIT License
├── eslint.config.js  .env.example  .gitignore
```

---

## Prerequisites

- Node.js **20.11+** (verified on v24.x)
- npm **10+**
- Internet access only for live GitHub scans and `npm install` (bundled demo mode requires no network)

---

## Install and Run

```bash
cd reporescue
npm install                      # installs client + server workspaces
cp .env.example .env             # optional configuration

npm run dev                      # Express API on :3001 + Vite client on :5173
# open http://localhost:5173
```

### Production Build & Single-Process Run

```bash
npm run build                    # vite build → client/dist
npm start                        # Express serves both API and static UI on :3001
```

### Verification Scripts

```bash
npm test                         # 109 unit + integration tests (node --test)
npm run lint                     # ESLint verification across client, server, shared, tests
npm run verify                   # lint → test → build (full CI verification pass)
```

---

## Production Deployment (Railway)

RepoRescue is fully pre-configured for production hosting on **Railway**. Refer to the comprehensive [Railway Production Deployment Guide](./RAILWAY_DEPLOYMENT.md) for step-by-step instructions covering:
- **Zero-Database Persistent Storage**: Attach a Railway Volume at `/data` with `REPORESCUE_DATA_DIR=/data`.
- **Token & Session Cryptography**: Generate 256-bit secrets via `openssl rand -hex 32` for `REPORESCUE_SESSION_SECRET` and `REPORESCUE_TOKEN_ENCRYPTION_KEY`.
- **SPA Fallback Routing**: Built-in Express 5 SPA fallback with client cache headers.
- **Reverse Proxy**: Native `trust proxy` support for Railway's edge router.
- **GitHub OAuth App**: Step-by-step guide to configure GitHub OAuth for user-directed fork PR delivery.

---

## Environment Configuration (`.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Express API port |
| `HOST` | `0.0.0.0` | Bind address |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Explicit client origin for cross-origin deployments |
| `GITHUB_TOKEN` | empty | Optional server-side GitHub PAT for live scans (raises rate limit from 60 to 5,000 req/hr). Never sent to the client. |
| `GEMINI_API_KEY` | empty | Optional Google Gemini API key for AI finding explanations. If omitted, RepoRescue uses evidence-grounded deterministic explanations. |
| `REPORESCUE_PERSIST` | `true` | Mirror scans and verifications to bounded JSON files |
| `REPORESCUE_DATA_DIR` | `./server/data` | JSON storage directory |
| `FRAME_ANCESTORS` | empty | CSP `frame-ancestors` embedding policy |
| `TRUST_PROXY` | `false` | Reverse proxy trust configuration |

---

## Demo Workflow (No API Keys Required)

1. Open the overview and click **Beacon API (TypeScript)** — a bundled deterministic fixture.
2. **SCAN** displays score **47/100** (coverage 85), 10 findings, 5-dimension breakdown, and specific point deductions.
3. **FIND**:
   - **Contribution Opportunities Tab**: Prioritized contributor opportunities (Difficulty, Priority, Beginner Friendly tags, Impact summary, Relevant files).
   - **All Findings Tab**: Search, filter by severity/category, expandable evidence with file & line references.
   - **✦ Explain with AI**: Click on any finding to generate an evidence-grounded explanation (or view the deterministic breakdown).
4. **FIX**: 6 rule-based patch proposals across 8 files with unified diffs, syntax validators, assumptions, and limitations. Manual-only findings provide explicit contributor steps.
5. **REVIEW**: File manifest, unified diffs, validator results, PR draft with branch name suggestion, **Copy** buttons, **Download .patch file**, **Download review ZIP**, and the **Contributor Playbook** detailing manual contribution steps.
6. **VERIFY**: Re-evaluates the rules against the patched in-memory workspace: score jumps **47 → 84** (6 resolved, 4 remaining, 0 newly detected). Remote CI and PR delivery remain `not-run`.

---

## AI Architecture & Disclosure

- **Optional & Grounded**: AI is an enhancement, not a dependency. If `GEMINI_API_KEY` is absent or rate-limited, RepoRescue generates structured, deterministic explanations directly from the scanner findings.
- **Untrusted Content Isolation**: Repository code, headings, excerpts, and issue text are treated as untrusted data. They are wrapped in explicit boundary delimiters with system instructions prohibiting prompt execution or instructions found in repository files.
- **Zero Token Leakage**: The Gemini API key is stored strictly on the server and never sent to the browser or written to scan records.
- **Transparent Labelling**: AI-assisted explanations are visibly badged with `✦ AI (Gemini Flash)` or `deterministic analysis` so users always know the provenance of information.

---

## Security Model & Contribution Safety

- **Responsible PR Delivery ("Fork, Don't Spam")**: RepoRescue never writes directly to upstream repositories. All blobs, trees, commits, and branches are created exclusively on the authenticated user's personal fork (`/repos/{user}/{repo}`) under minimal `read:user public_repo` scope. Pull requests are opened as cross-repository PRs only after explicit user review and validation of an HMAC-SHA256 confirmation token bound to the exact diff hash. Unauthenticated guest sessions safely export unified `.patch` files or ZIP packages without contacting GitHub write APIs.
- **Token Protection & Encryption at Rest**: Contributor access tokens are isolated to the server, never exposed in client bundles, and never stored in browser storage (`localStorage` / `sessionStorage`). Persisted session mirrors are encrypted at rest with AES-256-GCM bound to session AAD, and files are restricted to owner-only permissions (`0700` directory, `0600` session file).
- **Workflow Scope Isolation**: Automated fixes that touch GitHub Actions workflows (`.github/workflows/*`) require GitHub's privileged `workflow` scope. RepoRescue blocks workflow modifications before calling GitHub when the session lacks this permission, preventing partial failures.
- **Path Traversal Protection**: All generated paths and ZIP export entries are checked for directory traversal (`..`), absolute paths, and reserved characters before generation.
- **No Untrusted Code Execution**: RepoRescue performs purely static AST/regex analysis on retrieved files. It never installs dependencies, executes repository scripts, or runs untrusted code.
- **Strict Headers & Rate Limiting**: Production-grade CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and sliding-window rate limiters on all API routes.

---

## How to Contribute

We welcome contributions to RepoRescue! Please review [CONTRIBUTING.md](CONTRIBUTING.md) for full setup instructions, local development workflows, and our code of conduct. Security-related disclosures should follow [SECURITY.md](SECURITY.md).

---

## Tests & Verification

```
✔ 109 tests executed (109 passed, 0 failed)
✔ 0 ESLint errors across all workspaces
✔ Production Vite bundle built in < 500ms
```

- **Unit Tests**: Rule evaluation determinism, pinned score invariants, path safety, diff generation, validator behavior, patch plan consistency, progress tracking, opportunity derivation, OAuth security, token encryption (AES-256-GCM), and Gemini explanation fallbacks.
- **Integration Tests**: Express REST API endpoints on ephemeral ports (scans, findings, score, report, export, preview, validate, PR delivery pipeline, verification, explain endpoint, opportunities endpoint, session revocation).

---

## License & Compliance

Per the DevForge Hacktoberfest 2026 updated rulebook clarification, an MIT License is not mandatory for hackathon submission. RepoRescue adheres strictly to all updated hackathon regulations.

---

## AI Tools Used

- **Google Gemini API**: Optional server-side enhancement for plain-language finding explanations (strictly grounded in scan evidence; never generates patches or code).
- **AI Coding Assistants**: Antigravity was used during development for scaffolding, testing, and security hardening; all code is fully understood, audited, and maintained by the team.

---

## Credits & Acknowledgments

- **Core Frameworks & Tools**: React 19, Vite 7, React Router 7, Express 5, Tailwind CSS, Zod, ESLint 9, Concurrently.
- **Benchmark Fixtures**: Deterministic scan fixtures derived from real-world open-source patterns (`beacon-labs/beacon-api`, `tidewatch/tidewatch`).
- **Event**: DevForge Hacktoberfest 2026. Built by Team COGNIVANCE.

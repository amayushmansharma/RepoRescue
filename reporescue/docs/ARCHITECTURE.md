# RepoRescue Architecture

RepoRescue is an open-source contribution-readiness scanner and remediation workflow system.

```
+--------------------------------------------------------------------------+
|                              Vite + React SPA                             |
|  - Overview & Scanner Input      - Findings Explorer & AI Explainer      |
|  - Fix Workspace & Diff Previews - Review & One-Click PR Confirmation     |
+--------------------------------------------------------------------------+
                                     |  REST API (/api)
                                     v
+--------------------------------------------------------------------------+
|                          Express 5 API Backend                            |
|                                                                          |
|  +--------------------+  +--------------------+  +---------------------+ |
|  |   Auth & Session   |  |   Readiness Engine |  | Pull Request Engine | |
|  | - GitHub OAuth App |  | - 21 Deterministic |  | - Fork resolution   | |
|  | - HMAC Opaque Id   |  |   readiness checks |  | - Branch creation   | |
|  | - Token isolation  |  | - Weighted scoring |  | - Atomic tree/commit| |
|  +--------------------+  +--------------------+  +---------------------+ |
|                                                                          |
|  +--------------------+  +--------------------+  +---------------------+ |
|  |  Gemini AI Service |  | Remediation Service|  | Verification Runner | |
|  | - Plain-lang why   |  | - Auto-fix builders|  | - In-memory sandbox | |
|  | - Maintainer view  |  | - Unified diff gen |  | - Score projection  | |
|  +--------------------+  +--------------------+  +---------------------+ |
+--------------------------------------------------------------------------+
```

## Readiness Scoring Model

The overall readiness score (0–100) is computed from 21 deterministic rules categorized into five core dimensions:

1. **Documentation** (Weight: 25): README quality, runtime prerequisites, setup instructions, architecture documentation.
2. **Setup & Environment** (Weight: 25): Dependency manifests, environment templates (`.env.example`), port/database config.
3. **Testing & CI** (Weight: 20): Test runner detection, test commands, GitHub Actions CI workflows.
4. **Contribution Guidance** (Weight: 15): `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, PR/issue templates.
5. **Hygiene & Licensing** (Weight: 15): License file, manifest license field, `.gitignore`, absence of committed secrets.

Formula:
$$\text{Score} = \text{round}\left(100 \times \frac{\sum \text{earned check weight}}{\sum \text{applicable check weight}}\right)$$

Checks that are not applicable to the repository ecosystem are excluded from the denominator.

## Contribution Workflow Pipeline

1. **Scan**: Captures repository metadata and file trees. Runs readiness rules.
2. **Opportunities**: Maps findings into beginner-friendly, prioritized contribution opportunities.
3. **Fix**: Generates deterministic, syntax-valid remediation files.
4. **Review & Diff**: Computes line additions/removals and SHA-256 content hashes.
5. **Verify**: Simulates the patched workspace in memory to show projected score improvements.
6. **PR Delivery**:
   - Authenticates session and checks `public_repo` scope.
   - Verifies HMAC confirmation token.
   - Finds or provisions contributor fork on GitHub.
   - Creates a unique feature branch on the fork.
   - Writes git blobs and creates root-linked tree and commit.
   - Submits cross-repository Pull Request to the original upstream repository.

# Contributing to RepoRescue

Thank you for your interest in contributing to RepoRescue! We welcome contributions that improve readiness scanning, evidence detection, fix generation, and contributor experience.

## Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all contributors, regardless of experience level, gender identity, sexual orientation, disability, personal appearance, race, or religion.

## Getting Started

### Prerequisites
- Node.js 20.11 or later
- npm 10 or later
- Git

### Installation & Setup

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/reporescue.git
   cd reporescue
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your local environment configuration:
   ```bash
   cp .env.example .env
   ```
   Generate a 64-hex-character session secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Add this to `.env` as `REPORESCUE_SESSION_SECRET`.

4. Start development servers:
   ```bash
   npm run dev
   ```
   The Express API runs on port 3001, and the Vite client runs on port 5173.

## Verification & Standards

Before opening a pull request, run the full verification suite:

```bash
npm run verify
```

This runs:
- `npm run lint`: ESLint with zero-tolerance for lint errors or warnings
- `npm test`: Full test suite covering unit and integration tests (109 tests)
- `npm run build`: Production client build via Vite

## Contribution Guidelines

1. **Keep Secrets Server-Side**: Access tokens, OAuth credentials, and session keys must never be logged, sent to the browser, or included in client assets.
2. **Deterministic Rules**: Analysis rules in `server/src/analysis/rules.js` must be deterministic, evidence-backed, and reproducible across environments.
3. **Upstream Safety**: RepoRescue never writes directly to upstream repositories. Pull requests are opened exclusively through user-owned forks upon explicit approval.
4. **Minimal Dependencies**: The backend uses Node.js standard libraries and built-in test runners (`node --test`). Avoid introducing external database or heavy framework dependencies.

# Security Policy

RepoRescue takes security and contributor safety seriously. Because RepoRescue scans code and opens pull requests on behalf of developers, our architecture enforces defense-in-depth principles.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Architecture & Guarantees

1. **Strict Server-Side Token Isolation & Encryption at Rest**:
   - Contributor GitHub OAuth tokens are held in server memory for transient operations.
   - When the user selects "Remember this account", persistent sessions are mirrored to disk (`server/data/sessions.json`) encrypted at rest using AES-256-GCM with session-bound Additional Authenticated Data (AAD) and owner-only permissions (`0600` file, `0700` directory).
   - Tokens are never stored in scan assessment JSON files, never sent to frontend clients, never stored in browser storage (`localStorage` / `sessionStorage`), and never written to application logs.

2. **Opaque Signed Session Cookies**:
   - Session identifiers use cryptographic random bytes signed with HMAC-SHA256 (`REPORESCUE_SESSION_SECRET`).
   - Cookies are configured strictly with `HttpOnly`, `SameSite=Lax`, and `Path=/`.

3. **Read-Only Upstream Policy**:
   - RepoRescue **never writes directly to upstream repositories**.
   - All code changes, blobs, trees, commits, and branches are created exclusively on the authenticated user's personal fork (`/repos/{user}/{repo}`).
   - Pull requests are submitted as cross-repository pull requests (`head: "{user}:{branch}"`).

4. **Two-Phase Confirmation Tokens**:
   - GitHub write operations require an explicit two-step user confirmation.
   - The preview endpoint (`POST /api/pull-requests/preview`) computes a SHA-256 hash of all file contents and signs an HMAC-SHA256 confirmation token bound to the user session, exact diff hash, base commit SHA, and selection version.
   - The submission endpoint (`POST /api/pull-requests`) cryptographically verifies this confirmation token and re-validates the diff hash before executing any write operations.

5. **Path Traversal & Secret Protection**:
   - File paths are validated against directory traversal attacks (`..`, absolute paths, null bytes).
   - Sensitive files (`.env`, `.env.*`, private keys, certificates, credentials) are strictly forbidden from automated remediation commits.

6. **Workflow Scope Isolation**:
   - GitHub Actions workflows (`.github/workflows/*`) require GitHub's privileged `workflow` OAuth scope.
   - Without explicit workflow permission, attempts to modify workflows are blocked before making any calls to GitHub (`WORKFLOW_SCOPE_REQUIRED`), preventing broken state.

## Reporting a Vulnerability

If you discover a security vulnerability in RepoRescue, please report it privately:
- Do NOT open a public GitHub issue.
- Please email the repository maintainers directly with details, reproduction steps, and potential impact.
- Maintainers will acknowledge reports within 48 hours and work with you to patch and coordinate release.

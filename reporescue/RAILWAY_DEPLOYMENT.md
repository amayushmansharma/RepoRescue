# RepoRescue — Railway Production Deployment Guide

This guide provides instructions for deploying **RepoRescue** on [Railway](https://railway.com) as a production-ready, zero-maintenance service.

---

## 1. Architectural Overview

RepoRescue is packaged as a unified, single-service web application:
- **Backend**: Node.js 20+ and Express 5 REST API listening on `0.0.0.0:$PORT`.
- **Frontend**: React 19 + Vite 7 Single Page Application (SPA), built into `client/dist` and served statically by Express with cache-busting headers (`Cache-Control: no-cache` on `index.html`, 1-day caching on immutable assets).
- **SPA Fallback Routing**: Express handles client-side routes (`/scan/:id`, `/fix`, `/review`, `/verify`, `/methodology`) by serving `index.html` with explicit relative-root resolution.
- **Storage**: Lightweight, zero-database architecture. Scans, verifications, and user sessions are held in-memory and mirrored to bounded JSON files on disk. On Railway, this data can be persisted across deployments by attaching a **Railway Persistent Volume** mounted at `/data`.
- **Token Security**: GitHub OAuth tokens are encrypted at rest using **AES-256-GCM** with authenticated Additional Authenticated Data (AAD) binding and file permissions restricted to `0600`/`0700`.

---

## 2. Monorepo Notice & Railway Root Directory

The GitHub repository contains two components:
1. `reporescue/` — **The real RepoRescue application** (React + Express).
2. Repository root — Legacy sandbox template.

### Recommended Configuration (Option A: Root Directory = `reporescue`)
In the Railway Dashboard under **Settings → Service → General**:
- Set **Root Directory** to `reporescue`.
- Railway will detect `reporescue/railway.toml` and automatically run:
  - **Build Command**: `npm run build`
  - **Start Command**: `npm start`

### Alternative Configuration (Option B: Monorepo Root)
If the Root Directory is left blank (repository root), Railway will detect the repository-root `railway.toml` and execute:
- **Build Command**: `npm --prefix reporescue run build`
- **Start Command**: `npm --prefix reporescue start`

Both methods are fully pre-configured in this repository.

---

## 3. Environment Variables Reference

Configure these environment variables in Railway under **Variables**:

| Variable | Required? | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enables production mode, strict cookies (`Secure`), and disables development routes. |
| `PORT` | **Automatic** | *(Provided by Railway)* | The port Railway assigns to the container. Express automatically binds to this port. |
| `HOST` | Optional | `0.0.0.0` | Container bind address (already defaulted to `0.0.0.0`). |
| `REPORESCUE_SESSION_SECRET` | **Required** in prod | `openssl rand -hex 32` | 64-hex character secret for cryptographically signing opaque session cookies. |
| `REPORESCUE_TOKEN_ENCRYPTION_KEY` | **Required** in prod | `openssl rand -hex 32` | 64-hex character key for AES-256-GCM token encryption at rest. |
| `REPORESCUE_DATA_DIR` | **Recommended** | `/data` | Path to persistent storage directory. Mount a Railway volume at `/data`. |
| `REPORESCUE_PERSIST` | Optional | `true` | Enables JSON mirror storage on disk. Set `false` for in-memory-only mode. |
| `TRUST_PROXY` | Optional | `true` | Informs Express that requests come through Railway's reverse proxy. (Auto-detected on Railway). |
| `GITHUB_CLIENT_ID` | Optional | `Ov23li...` | GitHub OAuth App Client ID (for developer sign-in & PR submission). |
| `GITHUB_CLIENT_SECRET` | Optional | `4a9b...` | GitHub OAuth App Client Secret. |
| `GITHUB_CALLBACK_URL` | Optional | `https://<domain>.up.railway.app/api/auth/github/callback` | OAuth redirect URI matching your GitHub App registration. |
| `GITHUB_TOKEN` | Optional | `ghp_...` | Server-side personal access token to raise the GitHub API limit from 60/hr to 5,000/hr for live scans. |
| `GEMINI_API_KEY` | Optional | `AIzaSy...` | Google Gemini API key for AI-assisted finding explanations. If omitted, deterministic fallbacks are used. |

### Generating Cryptographic Secrets
Run this in your local terminal to generate high-entropy 256-bit secrets for Railway:
```bash
# Generate REPORESCUE_SESSION_SECRET
openssl rand -hex 32

# Generate REPORESCUE_TOKEN_ENCRYPTION_KEY
openssl rand -hex 32
```

> [!WARNING]
> Keep `REPORESCUE_TOKEN_ENCRYPTION_KEY` and `REPORESCUE_SESSION_SECRET` stable. If you change or regenerate `REPORESCUE_TOKEN_ENCRYPTION_KEY`, existing encrypted sessions stored in `/data/sessions.json` cannot be decrypted and users will need to sign in again.

---

## 4. Persistent Volume Setup (Zero Data Loss)

By default, Railway container file systems are ephemeral. Redeploying or restarting your container creates a new disk.

To persist recent scans, verifications, and signed-in sessions across deployments:
1. In the Railway project dashboard, click on your **RepoRescue Service**.
2. Click **+ Add Volume** (or navigate to the **Volumes** tab).
3. Set the **Mount Path** to:
   ```text
   /data
   ```
4. In **Variables**, ensure the following is set:
   ```env
   REPORESCUE_DATA_DIR=/data
   ```
5. RepoRescue will automatically create `/data` with owner-only permissions (`0700`) and store:
   - `/data/scans.json`
   - `/data/verifications.json`
   - `/data/pull-requests.json`
   - `/data/sessions.json` (with AES-256-GCM encrypted tokens)

---

## 5. GitHub OAuth Setup (1-Click PR Submission)

To enable GitHub login and user-directed fork PR delivery:
1. Go to **GitHub Developer Settings**: [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name**: `RepoRescue`
   - **Homepage URL**: `https://<your-railway-domain>.up.railway.app`
   - **Authorization callback URL**: `https://<your-railway-domain>.up.railway.app/api/auth/github/callback`
3. Click **Register application**.
4. Generate a **Client Secret**.
5. Copy **Client ID** and **Client Secret** into your Railway Service Variables:
   - `GITHUB_CLIENT_ID=<your-client-id>`
   - `GITHUB_CLIENT_SECRET=<your-client-secret>`
   - `GITHUB_CALLBACK_URL=https://<your-railway-domain>.up.railway.app/api/auth/github/callback`

---

## 6. Railway Configuration (`railway.toml`)

RepoRescue includes two pre-tested Railway configuration files:

### For Root Directory = `reporescue` (`reporescue/railway.toml`):
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/api/health"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

### For Monorepo Root (`./railway.toml`):
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm --prefix reporescue run build"

[deploy]
startCommand = "npm --prefix reporescue start"
healthcheckPath = "/api/health"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

Railway will automatically execute the health check against `/api/health` before routing live traffic, guaranteeing zero-downtime rolling deployments.

---

## 7. Step-by-Step Deployment Instructions

1. **Push your code to GitHub**:
   Ensure `main` branch is pushed to `https://github.com/amayushmansharma/RepoRescue`.

2. **Create Railway Project**:
   - Log in to [Railway](https://railway.com).
   - Click **New Project** → **Deploy from GitHub repo**.
   - Select `amayushmansharma/RepoRescue`.

3. **Configure Service Settings**:
   - Go to **Settings** → **Service** → **General**.
   - Set **Root Directory** to `reporescue` (Option A).

4. **Add Persistent Volume**:
   - In the service canvas or settings, click **Add Volume**.
   - Mount path: `/data`.

5. **Set Environment Variables**:
   In the **Variables** tab, add:
   ```env
   NODE_ENV=production
   REPORESCUE_SESSION_SECRET=<64-hex-char-secret>
   REPORESCUE_TOKEN_ENCRYPTION_KEY=<64-hex-char-secret>
   REPORESCUE_DATA_DIR=/data
   TRUST_PROXY=true
   ```
   *(Add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `GITHUB_TOKEN`, and `GEMINI_API_KEY` as needed).*

6. **Generate Domain**:
   - In **Settings** → **Networking**, click **Generate Domain** (e.g. `reporescue-production.up.railway.app`).
   - If using GitHub OAuth, update `GITHUB_CALLBACK_URL` and GitHub App settings to match this domain.

7. **Deploy**:
   - Railway will trigger a build using Nixpacks, run `npm run build`, and launch `npm start`.

---

## 8. Verification & Post-Deployment Checklist

Verify the live deployment using these checks:

| Check | Endpoint / Action | Expected Result |
| :--- | :--- | :--- |
| **Health API** | `GET /api/health` | HTTP 200, `"status": "healthy"`, storage path confirmed. |
| **Capabilities API** | `GET /api/config/capabilities` | HTTP 200, rule catalogue (21 checks), scoring weights. |
| **Vite SPA Direct Access** | `GET /` | HTTP 200, React client renders cleanly. |
| **Client SPA Fallback** | `GET /scan/demo-test` | HTTP 200, `index.html` returned with `Cache-Control: no-cache`. |
| **Methodology Page** | `GET /methodology` | HTTP 200, full scoring methodology renders. |
| **Demo Scan Flow** | Run demo scan in UI | Real phases reported, 21 checks evaluated, findings shown. |
| **Remediation & Review** | Select finding → "Fix" | Unified diff preview rendered with deterministic patch. |
| **Verification Flow** | Run in-browser verification | Score diff calculated, verification record persisted. |
| **Persistent Storage** | Restart container via Railway | Scan history, verifications, and sessions remain intact. |

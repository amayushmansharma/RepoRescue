import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../state/AuthContext.jsx";
import { Notice, Spinner } from "../components/ui.jsx";

export default function LoginPage() {
  const { user, authenticated, loading, authConfig, logout, remember: isSessionRemembered } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [initiating, setInitiating] = useState(false);
  const [rememberAccount, setRememberAccount] = useState(false);

  const authParam = searchParams.get("auth");

  function handleContinueWithGithub() {
    setInitiating(true);
    const query = rememberAccount ? "?remember=true" : "";
    window.location.href = `/api/auth/github/login${query}`;
  }

  const isOAuthConfigured = authConfig?.configured !== false;

  return (
    <div className="shell" style={{ paddingTop: 48, paddingBottom: 64, maxWidth: 580 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" className="dim mono hover-underline" style={{ fontSize: 12.5 }}>
          ← Back to Overview
        </Link>
      </div>

      <div className="glass panel" style={{ padding: "36px 32px" }}>
        {/* Brand header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(99, 230, 190, 0.1)",
              border: "1px solid rgba(99, 230, 190, 0.3)",
              marginBottom: 16,
              color: "var(--mint)",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" />
              <path d="M9.2 12.2l2 2 3.7-4" />
            </svg>
          </div>

          <h1 style={{ fontSize: "1.65rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
            Repo<span style={{ color: "var(--mint)" }}>Rescue</span>
          </h1>

          <p className="mono" style={{ fontSize: 13, color: "var(--mint)", marginTop: 6, letterSpacing: "0.04em" }}>
            Find problems. Understand them. Fix them.
          </p>

          <p className="muted" style={{ fontSize: 13.2, lineHeight: 1.6, marginTop: 12, maxWidth: 440, marginInline: "auto" }}>
            An intelligent open-source contribution assistant that helps developers understand repositories, discover
            improvement opportunities, prepare fixes, and contribute responsibly.
          </p>
        </div>

        {/* Auth status alerts */}
        {authParam === "connected" ? (
          <div style={{ marginBottom: 20 }}>
            <Notice tone="info" title="Authentication successful">
              You are signed in with GitHub.
            </Notice>
          </div>
        ) : null}

        {authParam === "access_denied" || authParam === "cancelled" ? (
          <div style={{ marginBottom: 20 }}>
            <Notice tone="warn" title="Authorization cancelled">
              GitHub authorization was not completed. You can try again or continue as a guest.
            </Notice>
          </div>
        ) : null}

        {authParam === "invalid_state" || authParam === "state_mismatch" || authParam === "expired" ? (
          <div style={{ marginBottom: 20 }}>
            <Notice tone="error" title="Session expired or invalid">
              The login authorization request expired or was invalid. Please try signing in again.
            </Notice>
          </div>
        ) : null}

        {authParam === "token_exchange_failed" || authParam === "authorization_failed" ? (
          <div style={{ marginBottom: 20 }}>
            <Notice tone="error" title="Authentication failed">
              Could not complete authentication with GitHub. Verify your connection or try again shortly.
            </Notice>
          </div>
        ) : null}

        {/* Authenticated State */}
        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <Spinner label="Checking authentication status…" />
          </div>
        ) : authenticated && user ? (
          <div className="subtle panel-tight" style={{ textAlign: "center", padding: "20px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 14 }}>
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.login}
                  style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)" }}
                />
              ) : null}
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{user.name || user.login}</div>
                <div className="mono dim" style={{ fontSize: 12 }}>@{user.login}</div>
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12.8, marginBottom: 16 }}>
              You are signed in with your GitHub account.{" "}
              {isSessionRemembered ? (
                <span className="mono" style={{ fontSize: 11.5, color: "var(--mint, #10B981)", display: "block", marginTop: 4 }}>
                  ✓ Kept signed in on this device (30-day persistent session)
                </span>
              ) : (
                <span className="mono dim" style={{ fontSize: 11.5, display: "block", marginTop: 4 }}>
                  (Standard session · expires in 4 hours)
                </span>
              )}
            </p>

            <div className="btn-row" style={{ justifyContent: "center" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/")}
              >
                Continue to Overview →
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => logout()}
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          /* Unauthenticated State */
          <div>
            {/* Primary Action: Continue with GitHub */}
            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleContinueWithGithub}
                disabled={!isOAuthConfigured || initiating}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "12px 18px",
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {initiating ? (
                  <Spinner label="Connecting to GitHub…" />
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      />
                    </svg>
                    Continue with GitHub
                  </>
                )}
              </button>
            </div>

            {/* Remember this account checkbox */}
            <div style={{ marginBottom: 18 }}>
              <label
                htmlFor="remember-account-checkbox"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  cursor: isOAuthConfigured && !initiating ? "pointer" : "default",
                  userSelect: "none",
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                }}
              >
                <input
                  id="remember-account-checkbox"
                  type="checkbox"
                  checked={rememberAccount}
                  onChange={(e) => setRememberAccount(e.target.checked)}
                  disabled={!isOAuthConfigured || initiating}
                  style={{
                    marginTop: 2,
                    cursor: isOAuthConfigured && !initiating ? "pointer" : "default",
                    accentColor: "var(--lemon, #FFF21A)",
                    width: 16,
                    height: 16,
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text, #E2E8F0)" }}>
                    Remember this account
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--text-dim, #94A3B8)", marginTop: 2 }}>
                    Keep me signed in on this device.
                  </span>
                </div>
              </label>
            </div>

            {/* OAuth not configured notice */}
            {!isOAuthConfigured ? (
              <div style={{ marginBottom: 18 }}>
                <Notice tone="info" title="GitHub OAuth not configured on this server">
                  <p style={{ fontSize: 12.2, lineHeight: 1.55 }}>
                    GitHub OAuth credentials (<span className="mono">GITHUB_CLIENT_ID</span> and{" "}
                    <span className="mono">GITHUB_CLIENT_SECRET</span>) have not been set in the server environment.
                  </p>
                  <p style={{ fontSize: 12.2, lineHeight: 1.55, marginTop: 6 }}>
                    You can explore all features using the demo mode below without signing in.
                  </p>
                </Notice>
              </div>
            ) : null}

            <div className="divider" style={{ margin: "22px 0 18px 0" }} />

            {/* Secondary Action: Explore Demo Without Signing In */}
            <div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate("/")}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "11px 16px",
                  fontSize: 13.5,
                  fontWeight: 500,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                Explore Demo Without Signing In →
              </button>
              <p className="dim" style={{ fontSize: 11.8, textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
                Hackathon judges and explorers: test the full 5-stage workflow (Scan, Find, Fix, Review, Verify) with
                bundled fixtures and no credentials.
              </p>
            </div>
          </div>
        )}

        {/* Security & permissions disclosure */}
        <div
          className="subtle panel-tight"
          style={{ marginTop: 28, fontSize: 11.5, lineHeight: 1.6, color: "var(--text-dim)" }}
        >
          <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
            🔒 Privacy &amp; Security Guarantee
          </div>
          <p>
            RepoRescue requests <span className="mono">read:user</span> and <span className="mono">public_repo</span> permissions.
            We <strong>never request private repository access</strong>, and we never write directly to upstream repositories.
            All contributions flow safely through your own fork with your explicit confirmation before every change.
          </p>
        </div>
      </div>
    </div>
  );
}

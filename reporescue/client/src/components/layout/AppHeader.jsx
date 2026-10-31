import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../state/AuthContext.jsx";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/methodology", label: "Scoring method" },
  { href: "/scans", label: "Scan history" },
];

export function AppHeader() {
  const { pathname } = useLocation();
  const { user, authenticated, hasWriteScope, requiresReauth, logout } = useAuth();

  return (
    <header className="site-header">
      <div className="shell header-row">
        <Link to="/" className="brand" aria-label="RepoRescue home">
          <span className="brand-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" />
              <path d="M9.2 12.2l2 2 3.7-4" />
            </svg>
          </span>
          <span>
            Repo<span style={{ color: "var(--mint)" }}>Rescue</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="nav-links">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} to={link.href} className="nav-link" aria-current={active ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            {hasWriteScope ? (
              <span className="badge badge-pass badge-mono" title="PR delivery enabled: fork, branch, commit & pull request via your GitHub account">
                <span className="pulse-dot" style={{ background: "var(--mint)" }} aria-hidden="true" /> PR delivery enabled
              </span>
            ) : requiresReauth ? (
              <Link
                to="/login"
                className="badge badge-medium badge-mono"
                title="public_repo scope required to deliver PRs. Click to authorize."
                style={{ textDecoration: "none" }}
              >
                <span className="pulse-dot" style={{ background: "var(--amber)" }} aria-hidden="true" /> re-auth for PR delivery
              </Link>
            ) : (
              <span className="badge badge-mono" title={authenticated ? "Signed in with read-only scopes" : "RepoRescue runs in read-only guest mode until you sign in"}>
                <span className="pulse-dot" aria-hidden="true" /> {authenticated ? "read-only mode" : "guest mode (read-only)"}
              </span>
            )}
          </div>

          {authenticated && user ? (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="flex items-center gap-2 subtle panel-tight"
                style={{ padding: "3px 8px 3px 4px", borderRadius: 20, textDecoration: "none" }}
                title={`Signed in as @${user.login}`}
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    style={{ width: 20, height: 20, borderRadius: "50%" }}
                  />
                ) : null}
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text)" }}>
                  @{user.login}
                </span>
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => logout()}
                style={{ fontSize: 11.5, padding: "4px 8px" }}
                title="Sign out of RepoRescue"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12, padding: "4px 10px", border: "1px solid rgba(255,255,255,0.15)" }}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppHeader } from "./components/layout/AppHeader.jsx";
import { ScanWorkspaceProvider, WorkspaceShell } from "./state/ScanWorkspaceProvider.jsx";
import { AuthProvider } from "./state/AuthContext.jsx";
import OverviewPage from "./pages/OverviewPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import MethodologyPage from "./pages/MethodologyPage.jsx";
import ScanHistoryPage from "./pages/ScanHistoryPage.jsx";
import { ScanSummary } from "./pages/ScanPage.jsx";
import { FindingsExplorer } from "./pages/FindingsPage.jsx";
import { FixWorkspace } from "./pages/FixesPage.jsx";
import { ReviewWorkspace } from "./pages/ReviewPage.jsx";
import { VerifyWorkspace } from "./pages/VerifyPage.jsx";

function WorkspaceLayout() {
  return (
    <ScanWorkspaceProvider>
      <WorkspaceShell>
        <Outlet />
      </WorkspaceShell>
    </ScanWorkspaceProvider>
  );
}

function RoutePositionReset() {
  const { pathname } = useLocation();
  const previousPath = useRef(null);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    const isNavigation = previousPath.current !== null;
    previousPath.current = pathname;
    // Explicit instant scrolling overrides the smooth in-page anchor behaviour.
    // A layout effect prevents a destination frame appearing at the old offset.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    if (isNavigation) {
      const target = document.querySelector("#main h1") ?? document.getElementById("main");
      if (target instanceof HTMLElement) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="shell" style={{ paddingTop: 60, paddingBottom: 40 }}>
      <span className="eyebrow">404</span>
      <h1 style={{ fontSize: "1.8rem", marginTop: 10 }}>That page does not exist</h1>
      <p className="muted" style={{ marginTop: 10 }}>
        Scans live under <span className="code-inline">/scan/&lt;scanId&gt;</span>. Start from the overview to create one.
      </p>
      <Link className="btn btn-primary" style={{ marginTop: 18 }} to="/">Back to overview</Link>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RoutePositionReset />
      <a href="#main" className="skip-link">Skip to main content</a>
      <div className="app-frame">
        <AppHeader />
        <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/scans" element={<ScanHistoryPage />} />
            <Route path="/scan" element={<Navigate to="/" replace />} />
            <Route path="/scan/:scanId" element={<WorkspaceLayout />}>
              <Route index element={<ScanSummary />} />
              <Route path="findings" element={<FindingsExplorer />} />
              <Route path="fix" element={<FixWorkspace />} />
              <Route path="review" element={<ReviewWorkspace />} />
              <Route path="verify" element={<VerifyWorkspace />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <footer style={{ marginTop: 56 }}>
          <div className="shell" style={{ paddingTop: 22, paddingBottom: 30 }}>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div style={{ maxWidth: 560 }}>
                <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-dim)" }}>
                  REPORESCUE · READINESS, NOT GUARANTEES
                </p>
                <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, marginTop: 8 }}>
                  Findings come from deterministic rules over scanned evidence. RepoRescue never executes repository code,
                  never installs dependencies and never writes directly to upstream repositories. Pull requests are opened
                  exclusively through user-owned forks upon explicit user approval. Demo mode uses bundled fixtures and is labelled
                  as such everywhere it appears.
                </p>
              </div>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2" style={{ fontSize: 12.5 }}>
                <Link className="muted" to="/">Overview</Link>
                <Link className="muted" to="/methodology">Scoring method</Link>
                <Link className="muted" to="/scans">Scan history</Link>
                <a className="muted" href="/api/health">API health</a>
              </nav>
            </div>
          </div>
        </footer>
      </div>
    </AuthProvider>
  );
}

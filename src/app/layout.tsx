import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time: no third-party request at runtime, no CSP relaxation.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains" });
import { AppHeader } from "@/components/shell/AppHeader";

export const metadata: Metadata = {
  title: "RepoRescue — open-source contribution readiness",
  description:
    "Scan a repository, understand evidence-backed onboarding findings, review safe patches and verify what actually changed. Demo mode needs no credentials.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only"
          style={{ position: "absolute", zIndex: 100, top: 12, left: 12, padding: "8px 12px", background: "#101010", borderRadius: 8 }}
        >
          Skip to main content
        </a>
        <div className="app-frame">
          <AppHeader />
          <main id="main">{children}</main>
          <footer style={{ marginTop: 56 }}>
            <div className="shell" style={{ paddingTop: 22, paddingBottom: 30 }}>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div style={{ maxWidth: 560 }}>
                  <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.06em", color: "var(--text-dim)" }}>
                    REPORESCUE · READINESS, NOT GUARANTEES
                  </p>
                  <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.66, marginTop: 8 }}>
                    Findings come from deterministic rules over scanned evidence. RepoRescue never executes repository
                    code, never installs dependencies and performs no GitHub writes. Demo mode uses bundled fixtures and
                    is labelled as such everywhere it appears.
                  </p>
                </div>
                <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2" style={{ fontSize: 12.5 }}>
                  <Link className="muted" href="/">Overview</Link>
                  <Link className="muted" href="/methodology">Scoring method</Link>
                  <Link className="muted" href="/scans">Scan history</Link>
                  <a className="muted" href="/api/health">API health</a>
                </nav>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

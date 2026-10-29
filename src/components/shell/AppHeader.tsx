"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/methodology", label: "Scoring method" },
  { href: "/scans", label: "Scan history" },
];

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="shell header-row">
        <Link href="/" className="brand" aria-label="RepoRescue home">
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
              <Link key={link.href} href={link.href} className="nav-link" aria-current={active ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden sm:flex items-center gap-2">
          <span className="badge badge-mono" title="RepoRescue performs no GitHub writes in this build">
            <span className="pulse-dot" aria-hidden="true" /> writes disabled
          </span>
        </div>
      </div>
    </header>
  );
}

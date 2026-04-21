import { NavLink, Outlet } from "react-router-dom";
import { Terminal } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { StatusBanner } from "./StatusBanner";
import { ThemeToggle } from "./ThemeToggle";
import { InlineCode } from "./CodeBlock";

export function AppShell() {
  const { configured, session, signOut } = useAuth();

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>

      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" aria-label="workflow-manager home">
            <Logo />
          </NavLink>

          <nav className="nav" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}>
              Overview
            </NavLink>
            <NavLink to="/search" className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}>
              Search
            </NavLink>
            <NavLink to="/dashboard" className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}>
              Dashboard
            </NavLink>
            <NavLink to="/dashboard/publish" className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}>
              Publish
            </NavLink>
            <NavLink to="/dashboard/tokens" className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}>
              Tokens
            </NavLink>
          </nav>

          <div className="topbar__right">
            <ThemeToggle />
            {!session && (
              <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/auth")}>
                Sign in
              </Button>
            )}
            {session && (
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="stack-lg">
        {!configured && (
          <StatusBanner tone="warn" icon={<Terminal size={16} strokeWidth={2} aria-hidden="true" />}>
            Supabase credentials not configured. Set <InlineCode>VITE_SUPABASE_URL</InlineCode> and{" "}
            <InlineCode>VITE_SUPABASE_PUBLISHABLE_KEY</InlineCode> to enable auth and registry actions.
          </StatusBanner>
        )}
        <Outlet />
      </main>
    </div>
  );
}

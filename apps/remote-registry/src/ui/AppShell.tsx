import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, Terminal, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { StatusBanner } from "./StatusBanner";
import { ThemeToggle } from "./ThemeToggle";
import { InlineCode } from "./CodeBlock";

const navLinks = [
  { to: "/", label: "Overview", end: true },
  { to: "/search", label: "Search", end: false },
  { to: "/dashboard", label: "Dashboard", end: true },
  { to: "/dashboard/publish", label: "Publish", end: false },
  { to: "/dashboard/tokens", label: "Tokens", end: false },
];

export function AppShell() {
  const { configured, session, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>

      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" aria-label="workflow-manager home" onClick={closeMenu}>
            <Logo />
          </NavLink>

          <nav className="nav" aria-label="Primary">
            {navLinks.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}
              >
                {label}
              </NavLink>
            ))}
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
            <button
              className="nav-toggle"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={18} strokeWidth={2} /> : <Menu size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="nav-mobile" aria-label="Primary mobile">
            {navLinks.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}
                onClick={closeMenu}
              >
                {label}
              </NavLink>
            ))}
            <div className="nav-mobile__auth">
              {!session && (
                <Button variant="ghost" size="sm" onClick={() => { closeMenu(); window.location.href = "/auth"; }}>
                  Sign in
                </Button>
              )}
              {session && (
                <Button variant="ghost" size="sm" onClick={() => { closeMenu(); void signOut(); }}>
                  Sign out
                </Button>
              )}
            </div>
          </nav>
        )}
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

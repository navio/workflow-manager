import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AppShell() {
  const { configured, session, signOut } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">workflow-manager</p>
          <h1>Remote Registry</h1>
        </div>
        <nav className="nav">
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/dashboard/tokens">Tokens</NavLink>
          {!session && <NavLink to="/auth">Sign in</NavLink>}
          {session && (
            <button className="ghost-button" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </nav>
      </header>

      {!configured && (
        <div className="banner warning">
          Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to enable auth and registry actions.
        </div>
      )}

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

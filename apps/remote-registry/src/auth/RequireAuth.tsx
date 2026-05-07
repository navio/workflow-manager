import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";
import { Eyebrow } from "../ui/Panel";

interface RequireAuthProps {
  children?: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="stack-lg">
        <Eyebrow>Session</Eyebrow>
        <p className="muted">Checking your session…</p>
      </div>
    );
  }

  if (!session) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    const params = new URLSearchParams({ next });
    return <Navigate to={`/auth?${params.toString()}`} replace />;
  }

  return children ?? <Outlet />;
}

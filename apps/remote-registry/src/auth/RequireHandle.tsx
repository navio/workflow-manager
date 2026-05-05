import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { Eyebrow } from "../ui/Panel";
import { StatusBanner } from "../ui/StatusBanner";
import { useAuth } from "./useAuth";

interface RequireHandleProps {
  children?: ReactNode;
}

interface HandleState {
  loading: boolean;
  hasHandle: boolean;
  error: string | null;
}

export function RequireHandle({ children }: RequireHandleProps) {
  const { loading: authLoading, session } = useAuth();
  const supabase = getSupabaseBrowserClient();
  const location = useLocation();
  const [handleState, setHandleState] = useState<HandleState>({
    loading: true,
    hasHandle: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function checkHandle() {
      if (!session?.user.id || !supabase) {
        setHandleState({ loading: false, hasHandle: false, error: null });
        return;
      }

      setHandleState((current) => ({ ...current, loading: true, error: null }));

      const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (error) {
        setHandleState({ loading: false, hasHandle: false, error: error.message });
        return;
      }

      setHandleState({ loading: false, hasHandle: Boolean(data?.username), error: null });
    }

    void checkHandle();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id, supabase]);

  if (authLoading || handleState.loading) {
    return (
      <div className="stack-lg">
        <Eyebrow>Session</Eyebrow>
        <p className="muted">Checking your profile…</p>
      </div>
    );
  }

  if (!session) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    const params = new URLSearchParams({ next });
    return <Navigate to={`/auth?${params.toString()}`} replace />;
  }

  if (handleState.error) {
    return (
      <div className="stack-lg">
        <Eyebrow>Onboarding</Eyebrow>
        <StatusBanner tone="err">{handleState.error}</StatusBanner>
      </div>
    );
  }

  if (!handleState.hasHandle) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    const params = new URLSearchParams({ next });
    return <Navigate to={`/onboard/handle?${params.toString()}`} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}

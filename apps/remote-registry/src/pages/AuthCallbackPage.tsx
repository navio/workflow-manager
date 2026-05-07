import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { consumeAuthNextPath, sanitizeAuthNextPath } from "../auth/auth-next";
import { useAuth } from "../auth/useAuth";
import { AuthCard } from "../ui/AuthCard";
import { StatusBanner } from "../ui/StatusBanner";

export function AuthCallbackPage() {
  const { configured, exchangeOAuthCode, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const nextPath = sanitizeAuthNextPath(searchParams.get("next"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runCallback() {
      if (!configured) {
        setError("Supabase auth is not configured.");
        return;
      }

      if (session) {
        const next = consumeAuthNextPath() ?? nextPath;
        void navigate(next, { replace: true });
        return;
      }

      if (!code) {
        setError("Missing OAuth code in callback URL.");
        return;
      }

      try {
        await exchangeOAuthCode(code);
        if (!cancelled) {
          const next = consumeAuthNextPath() ?? nextPath;
          void navigate(next, { replace: true });
        }
      } catch (callbackError) {
        if (!cancelled) {
          setError((callbackError as Error).message);
        }
      }
    }

    void runCallback();

    return () => {
      cancelled = true;
    };
  }, [code, configured, exchangeOAuthCode, navigate, nextPath, session]);

  return (
    <AuthCard
      title="Completing sign-in"
      eyebrow="Auth / callback"
      description="Finalizing your OAuth session."
    >
      {!error && <StatusBanner tone="info">Please wait while we complete authentication.</StatusBanner>}
      {error && (
        <>
          <StatusBanner tone="err">{error}</StatusBanner>
          <div className="auth-links">
            <Link to="/auth?mode=signin">Return to sign in</Link>
          </div>
        </>
      )}
    </AuthCard>
  );
}

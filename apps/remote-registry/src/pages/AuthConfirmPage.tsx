import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import { useAuth } from "../auth/useAuth";
import { AuthCard } from "../ui/AuthCard";
import { StatusBanner } from "../ui/StatusBanner";

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return (
    value === "signup" ||
    value === "invite" ||
    value === "magiclink" ||
    value === "recovery" ||
    value === "email_change" ||
    value === "email"
  );
}

export function AuthConfirmPage() {
  const { configured, confirmEmail } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const tokenType = searchParams.get("type");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runConfirmation() {
      if (!configured) {
        setError("Supabase auth is not configured.");
        return;
      }

      if (!tokenHash || !isEmailOtpType(tokenType)) {
        setError("Invalid confirmation link. Request a new one and try again.");
        return;
      }

      try {
        await confirmEmail(tokenHash, tokenType);
        if (!cancelled) {
          void navigate("/dashboard", { replace: true });
        }
      } catch (confirmError) {
        if (!cancelled) {
          setError((confirmError as Error).message);
        }
      }
    }

    void runConfirmation();

    return () => {
      cancelled = true;
    };
  }, [configured, confirmEmail, navigate, tokenHash, tokenType]);

  return (
    <AuthCard
      title="Confirming your email"
      eyebrow="Auth / confirm"
      description="Verifying your confirmation link and finishing sign-in."
    >
      {!error && <StatusBanner tone="info">Please wait while we confirm your email.</StatusBanner>}
      {error && (
        <>
          <StatusBanner tone="err">{error}</StatusBanner>
          <div className="auth-links">
            <Link to="/auth?mode=signin">Back to sign in</Link>
            <Link to="/auth/check-email">Try a different link</Link>
          </div>
        </>
      )}
    </AuthCard>
  );
}

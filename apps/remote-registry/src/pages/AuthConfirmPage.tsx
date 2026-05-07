import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import { useAuth } from "../auth/useAuth";
import { getSupabaseUrl } from "../lib/env";
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
  const { configured, confirmEmail, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const legacyToken = searchParams.get("token");
  const tokenType = searchParams.get("type");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runConfirmation() {
      if (!configured) {
        setError("Supabase auth is not configured.");
        return;
      }

      if (session) {
        if (!cancelled) {
          void navigate("/dashboard", { replace: true });
        }
        return;
      }

      if (tokenHash && isEmailOtpType(tokenType)) {
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
        return;
      }

      if (legacyToken && isEmailOtpType(tokenType)) {
        if (typeof window === "undefined") {
          setError("Invalid confirmation link. Request a new one and try again.");
          return;
        }

        const verifyUrl = new URL("/auth/v1/verify", getSupabaseUrl());
        verifyUrl.searchParams.set("token", legacyToken);
        verifyUrl.searchParams.set("type", tokenType);
        verifyUrl.searchParams.set("redirect_to", new URL("/auth/confirm", window.location.origin).toString());
        window.location.assign(verifyUrl.toString());
        return;
      }

      if (!tokenHash || !isEmailOtpType(tokenType)) {
        setError("Invalid confirmation link. Request a new one and try again.");
        return;
      }
    }

    void runConfirmation();

    return () => {
      cancelled = true;
    };
  }, [configured, confirmEmail, legacyToken, navigate, session, tokenHash, tokenType]);

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

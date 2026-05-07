import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { getSupabaseUrl } from "../lib/env";
import { AuthCard } from "../ui/AuthCard";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { StatusBanner } from "../ui/StatusBanner";

export function ResetPasswordConfirmPage() {
  const { configured, loading, session, confirmEmail, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const tokenType = searchParams.get("type");
  const legacyToken = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initializeRecoverySession() {
      if (!configured || loading || session) {
        return;
      }

      if (tokenHash && tokenType === "recovery") {
        setVerifying(true);
        setError(null);
        try {
          await confirmEmail(tokenHash, "recovery");
        } catch (verifyError) {
          if (!cancelled) {
            setError((verifyError as Error).message);
          }
        } finally {
          if (!cancelled) {
            setVerifying(false);
          }
        }
        return;
      }

      if (legacyToken && tokenType === "recovery") {
        if (typeof window === "undefined") {
          return;
        }

        const verifyUrl = new URL("/auth/v1/verify", getSupabaseUrl());
        verifyUrl.searchParams.set("token", legacyToken);
        verifyUrl.searchParams.set("type", "recovery");
        verifyUrl.searchParams.set("redirect_to", new URL("/auth/reset/confirm", window.location.origin).toString());
        window.location.assign(verifyUrl.toString());
      }
    }

    void initializeRecoverySession();

    return () => {
      cancelled = true;
    };
  }, [configured, confirmEmail, legacyToken, loading, session, tokenHash, tokenType]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      await updatePassword(password);
      setNotice("Password updated. Redirecting to dashboard…");
      void navigate("/dashboard", { replace: true });
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || verifying) {
    return (
      <AuthCard
        title="Choose a new password"
        eyebrow="Auth / reset / confirm"
        description="Checking your recovery session."
      >
        <StatusBanner tone="info">Preparing password reset.</StatusBanner>
      </AuthCard>
    );
  }

  if (!session) {
    return (
      <AuthCard
        title="Choose a new password"
        eyebrow="Auth / reset / confirm"
        description="This reset link is missing an active recovery session."
      >
        <StatusBanner tone="warn">Open your latest reset email and click the link again.</StatusBanner>
        <div className="auth-links">
          <Link to="/auth/reset">Request a new reset link</Link>
          <Link to="/auth?mode=signin">Back to sign in</Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      eyebrow="Auth / reset / confirm"
      description="Set a new password for your registry account."
    >
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <Field label="New password" required hint="Use at least 8 characters.">
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <Field label="Confirm password" required>
          <input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </Field>

        <Button type="submit" variant="primary" disabled={!configured || busy}>
          {busy ? "Saving…" : "Update password"}
        </Button>
      </form>

      {notice && <StatusBanner tone="ok">{notice}</StatusBanner>}
      {error && <StatusBanner tone="err">{error}</StatusBanner>}
    </AuthCard>
  );
}

import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AuthCard } from "../ui/AuthCard";
import { Button } from "../ui/Button";
import { StatusBanner } from "../ui/StatusBanner";

type CheckEmailIntent = "signup" | "reset";

function readIntent(value: string | null): CheckEmailIntent {
  return value === "reset" ? "reset" : "signup";
}

export function CheckEmailPage() {
  const { configured, resendConfirmation, requestPasswordReset } = useAuth();
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const intent = readIntent(searchParams.get("intent"));
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cooldownRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) {
        window.clearTimeout(cooldownRef.current);
      }
    };
  }, []);

  const copy =
    !email
      ? intent === "reset"
        ? "Request a new password-reset email from the reset page."
        : "Request a new confirmation email from the sign-up page."
      : intent === "reset"
        ? (
            <>
              We sent a reset link to <strong>{email}</strong>. Open the link to choose a new password.
            </>
          )
        : (
            <>
              We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your account.
            </>
          );

  async function onResend(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    if (!email || !configured) {
      return;
    }

    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (intent === "reset") {
        await requestPasswordReset(email);
        setNotice("Password reset email sent.");
      } else {
        await resendConfirmation(email);
        setNotice("Confirmation email sent.");
      }

      setCooldown(true);
      if (cooldownRef.current) {
        window.clearTimeout(cooldownRef.current);
      }
      cooldownRef.current = window.setTimeout(() => {
        setCooldown(false);
      }, 60000);
    } catch (resendError) {
      setError((resendError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const resendDisabled = !configured || !email || busy || cooldown;

  return (
    <AuthCard
      title={intent === "reset" ? "Check your email" : "Confirm your email"}
      eyebrow={intent === "reset" ? "Auth / reset" : "Auth / signup"}
      description={copy}
    >
      {notice && <StatusBanner tone="ok">{notice}</StatusBanner>}
      {error && <StatusBanner tone="err">{error}</StatusBanner>}

      <div className="auth-actions">
        <Button type="button" variant="ghost" onClick={onResend} disabled={resendDisabled}>
          {busy ? "Sending…" : "Resend email"}
        </Button>
      </div>

      <div className="auth-links">
        <Link to="/auth?mode=signin">Back to sign in</Link>
      </div>
    </AuthCard>
  );
}

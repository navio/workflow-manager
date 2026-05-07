import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AuthCard } from "../ui/AuthCard";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { StatusBanner } from "../ui/StatusBanner";

export function ResetPasswordPage() {
  const { configured, requestPasswordReset, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      void navigate("/dashboard", { replace: true });
    }
  }, [navigate, session]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await requestPasswordReset(email);
      const params = new URLSearchParams({ intent: "reset", email });
      void navigate(`/auth/check-email?${params.toString()}`, { replace: true });
    } catch (resetError) {
      setError((resetError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      eyebrow="Auth / reset"
      description="Enter your account email and we will send you a reset link."
    >
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <Field label="Email" required>
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Button type="submit" variant="primary" disabled={!configured || busy}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      {error && <StatusBanner tone="err">{error}</StatusBanner>}

      <div className="auth-links">
        <Link to="/auth?mode=signin">Back to sign in</Link>
      </div>
    </AuthCard>
  );
}

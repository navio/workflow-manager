import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Terminal } from "lucide-react";
import { storeAuthNextPath, sanitizeAuthNextPath } from "../auth/auth-next";
import { useAuth } from "../auth/useAuth";
import { InlineCode } from "../ui/CodeBlock";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { OAuthButton } from "../ui/OAuthButton";
import { AuthCard } from "../ui/AuthCard";
import { StatusBanner } from "../ui/StatusBanner";

type AuthMode = "signin" | "signup" | "reset";

function readMode(value: string | null): AuthMode {
  if (value === "signup") {
    return "signup";
  }

  if (value === "reset") {
    return "reset";
  }

  return "signin";
}

export function AuthPage() {
  const { configured, signIn, signUp, signInWithGoogle, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = readMode(searchParams.get("mode"));
  const nextPath = sanitizeAuthNextPath(searchParams.get("next"));
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  useEffect(() => {
    if (mode === "reset") {
      void navigate("/auth/reset", { replace: true });
      return;
    }

    if (session) {
      void navigate(nextPath, { replace: true });
    }
  }, [mode, navigate, nextPath, session]);

  const title = mode === "signup" ? "Create your registry account" : "Sign in to workflow-manager";

  const description =
    mode === "signup"
      ? "Create an account, confirm your email, and claim a handle before publishing your first workflow."
      : "Use your account to publish workflows, manage tokens, and track registry activity.";

  const resetHref = useMemo(() => {
    const params = new URLSearchParams();
    if (email) {
      params.set("email", email);
    }
    return params.size > 0 ? `/auth/reset?${params.toString()}` : "/auth/reset";
  }, [email]);

  function switchMode(nextMode: Exclude<AuthMode, "reset">) {
    const params = new URLSearchParams(searchParams);
    params.set("mode", nextMode);
    if (email) {
      params.set("email", email);
    } else {
      params.delete("email");
    }
    setSearchParams(params, { replace: true });
    setError(null);
  }

  async function handleOAuthSignIn() {
    if (!configured) {
      return;
    }

    setError(null);
    setOauthBusy(true);

    try {
      storeAuthNextPath(nextPath);
      await signInWithGoogle();
    } catch (authError) {
      setError((authError as Error).message);
      setOauthBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === "signup") {
        await signUp(email, password);
        const params = new URLSearchParams({ intent: "signup", email });
        void navigate(`/auth/check-email?${params.toString()}`, { replace: true });
        return;
      }

      await signIn(email, password);
      void navigate(nextPath, { replace: true });
    } catch (authError) {
      setError((authError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={title}
      description={description}
      footnote={
        <>
          Prefer the terminal? Run <InlineCode>workflow-manager auth login --token {"<token>"}</InlineCode> after
          minting one in the dashboard.
        </>
      }
    >
      {!configured && (
        <StatusBanner tone="warn" icon={<Terminal size={16} strokeWidth={1.75} aria-hidden="true" />}>
          Supabase credentials missing. Set <InlineCode>VITE_SUPABASE_URL</InlineCode> and{" "}
          <InlineCode>VITE_SUPABASE_PUBLISHABLE_KEY</InlineCode> to enable auth.
        </StatusBanner>
      )}

      <OAuthButton disabled={!configured} busy={oauthBusy} onClick={handleOAuthSignIn} />

      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>

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

        <Field
          label="Password"
          required
          hint={mode === "signup" ? "Use at least 8 characters." : undefined}
        >
          <input
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <Button type="submit" variant="primary" disabled={!configured || busy || oauthBusy}>
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>

      {error && <StatusBanner tone="err">{error}</StatusBanner>}

      <div className="auth-links">
        {mode === "signin" ? (
          <button type="button" className="auth-link-button" onClick={() => switchMode("signup")}>
            Need an account? Create one.
          </button>
        ) : (
          <button type="button" className="auth-link-button" onClick={() => switchMode("signin")}>
            Already have an account? Sign in.
          </button>
        )}
        <Link to={resetHref}>Forgot password?</Link>
      </div>
    </AuthCard>
  );
}

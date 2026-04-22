import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Terminal } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { InlineCode } from "../ui/CodeBlock";
import { Eyebrow } from "../ui/Panel";
import { StatusBanner } from "../ui/StatusBanner";

type Mode = "sign-in" | "sign-up";

export function AuthPage() {
  const { configured, signIn, signUp, session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) {
      void navigate("/dashboard");
    }
  }, [navigate, session]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
        void navigate("/dashboard");
        return;
      }

      await signUp(email, password);
      setMessage("Account created. If confirmations are enabled, check your inbox before signing in.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <section className="auth-card panel stack-lg">
        <div className="stack-sm">
          <Eyebrow>Registry access</Eyebrow>
          <h1 className="auth-card__title">{mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
          <p className="muted">
            {mode === "sign-in"
              ? "Access the dashboard, manage tokens, and publish from the CLI."
              : "Reserve a handle, publish workflows, and track downloads."}
          </p>
        </div>

        <div className="segmented" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-in"}
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-up"}
            onClick={() => setMode("sign-up")}
          >
            Create account
          </button>
        </div>

        {!configured && (
          <StatusBanner tone="warn" icon={<Terminal size={16} strokeWidth={2} aria-hidden="true" />}>
            Supabase credentials missing. Set <InlineCode>VITE_SUPABASE_URL</InlineCode> and{" "}
            <InlineCode>VITE_SUPABASE_PUBLISHABLE_KEY</InlineCode> to enable auth.
          </StatusBanner>
        )}

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
            hint={mode === "sign-up" ? "Use 8+ characters with a mix of letters and numbers." : undefined}
          >
            <input
              name="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={!configured || busy} variant="primary">
            {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {message && <StatusBanner tone="ok">{message}</StatusBanner>}
        {error && <StatusBanner tone="err">{error}</StatusBanner>}
      </section>

      <p className="muted auth-footnote">
        Prefer the terminal? Run <InlineCode>workflow-manager auth login --token {"<token>"}</InlineCode> after minting one in the dashboard.
      </p>
    </div>
  );
}

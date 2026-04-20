import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AuthPage() {
  const { configured, signIn, signUp, session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      void navigate("/dashboard");
    }
  }, [navigate, session]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
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
    }
  }

  return (
    <section className="panel narrow-panel stack">
      <div>
        <p className="eyebrow">Registry access</p>
        <h2>{mode === "sign-in" ? "Sign in" : "Create account"}</h2>
      </div>
      {!configured && <div className="banner warning">Supabase browser credentials are not configured for this app yet.</div>}
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <label className="stack compact">
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="stack compact">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" disabled={!configured}>
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}
      <button className="ghost-button align-start" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}> 
        {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
      </button>
    </section>
  );
}

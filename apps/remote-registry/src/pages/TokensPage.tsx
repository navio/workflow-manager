import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { createCliToken } from "../lib/remoteApi";
import type { TokenSummary } from "../types";

export function TokensPage() {
  const { loading, session } = useAuth();
  const [name, setName] = useState("local-cli");
  const [createdToken, setCreatedToken] = useState<TokenSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) {
    return <section className="panel">Checking session...</section>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await createCliToken(session.access_token, name);
      setCreatedToken(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="stack">
      <div className="panel narrow-panel stack">
        <div>
          <p className="eyebrow">CLI access</p>
          <h2>Create a token</h2>
        </div>
        <form className="stack" onSubmit={(event) => void onSubmit(event)}>
          <label className="stack compact">
            <span>Token name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? "Creating token..." : "Create token"}
          </button>
        </form>
        {error && <div className="banner error">{error}</div>}
      </div>

      {createdToken && (
        <div className="panel stack">
          <h3>Copy this token now</h3>
          <p>This secret is only shown once. Store it in your local CLI config.</p>
          <code>{createdToken.token}</code>
          <code>{`workflow-manager auth login --token ${createdToken.token}`}</code>
        </div>
      )}
    </section>
  );
}

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { createCliToken, listCliTokens, revokeCliToken } from "../lib/remoteApi";
import type { TokenSummary } from "../types";

export function TokensPage() {
  const { loading, session } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("local-cli");
  const [createdToken, setCreatedToken] = useState<TokenSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["cli-tokens", session?.access_token],
    queryFn: () => listCliTokens(session!.access_token),
    enabled: Boolean(session?.access_token),
  });

  const createTokenMutation = useMutation({
    mutationFn: (tokenName: string) => createCliToken(session!.access_token, tokenName),
    onSuccess(created) {
      setCreatedToken(created);
      void queryClient.invalidateQueries({ queryKey: ["cli-tokens", session?.access_token] });
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) => revokeCliToken(session!.access_token, tokenId),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["cli-tokens", session?.access_token] });
    },
  });

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
    setError(null);
    try {
      await createTokenMutation.mutateAsync(name);
    } catch (err) {
      setError((err as Error).message);
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
            <input name="token-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <button type="submit" disabled={createTokenMutation.isPending}>
            {createTokenMutation.isPending ? "Creating token..." : "Create token"}
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

      <div className="panel stack">
        <div className="workflow-card__header">
          <div>
            <p className="eyebrow">Issued tokens</p>
            <h3>Manage CLI access</h3>
          </div>
          <span className="pill">{tokens.data?.items.length ?? 0} total</span>
        </div>

        {tokens.isLoading && <p>Loading CLI tokens...</p>}
        {tokens.isError && <div className="banner error">{(tokens.error as Error).message}</div>}
        {tokens.data && tokens.data.items.length === 0 && <p>No tokens created yet.</p>}

        <div className="stack compact">
          {tokens.data?.items.map((token) => (
            <article key={token.tokenId} className="panel inset-panel token-row">
              <div className="workflow-card__header">
                <div>
                  <h3>{token.name ?? token.tokenId}</h3>
                  <p className="eyebrow">{token.active ? "Active" : "Revoked"}</p>
                </div>
                <span className={`pill ${token.active ? "" : "muted"}`}>{token.active ? "Active" : "Revoked"}</span>
              </div>
              <div className="stats-grid">
                <div>
                  <strong>{new Date(token.createdAt).toLocaleDateString()}</strong>
                  <span>Created</span>
                </div>
                <div>
                  <strong>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "Never"}</strong>
                  <span>Last used</span>
                </div>
                <div>
                  <strong>{token.scopes.join(", ")}</strong>
                  <span>Scopes</span>
                </div>
              </div>
              {token.active && (
                <button className="danger-button align-start" onClick={() => void revokeTokenMutation.mutateAsync(token.tokenId)}>
                  {revokeTokenMutation.isPending ? "Updating..." : "Revoke token"}
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

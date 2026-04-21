import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { createCliToken, listCliTokens, revokeCliToken } from "../lib/remoteApi";
import type { TokenSummary } from "../types";
import { Button } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Field } from "../ui/Field";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

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
    return (
      <div className="stack-lg">
        <Eyebrow>Session</Eyebrow>
        <p className="muted">Checking session…</p>
      </div>
    );
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

  const activeCount = tokens.data?.items.filter((token) => token.active).length ?? 0;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>Dashboard / tokens</Eyebrow>
        <h1>CLI tokens</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Mint a token to sign the CLI in. Each token is shown exactly once — store it in your shell config or a secret manager.
        </p>
      </div>

      <div className="grid-publish">
        <form
          className="panel stack"
          onSubmit={(event) => void onSubmit(event)}
        >
          <Eyebrow>Create token</Eyebrow>
          <Field label="Token name" required hint="Something descriptive — e.g. laptop, ci, sandbox.">
            <input
              name="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            disabled={createTokenMutation.isPending}
            leading={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
          >
            {createTokenMutation.isPending ? "Creating…" : "Create token"}
          </Button>
          {error && <StatusBanner tone="err">{error}</StatusBanner>}
        </form>

        {createdToken ? (
          <aside className="panel stack reveal">
            <div className="cluster between">
              <div className="stack-sm">
                <Eyebrow>One-time reveal</Eyebrow>
                <h2>Copy this now</h2>
              </div>
              <Pill tone="warn" leading={<ShieldAlert size={12} strokeWidth={2} aria-hidden="true" />}>
                Shown once
              </Pill>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              This secret won't appear again. Store it somewhere safe before leaving this page.
            </p>
            <CodeBlock>{createdToken.token ?? ""}</CodeBlock>
            <Eyebrow>CLI command</Eyebrow>
            <CodeBlock prompt>{`workflow-manager auth login --token ${createdToken.token}`}</CodeBlock>
          </aside>
        ) : (
          <aside className="panel stack">
            <Eyebrow>How tokens work</Eyebrow>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              Tokens carry your publish + pull scopes. They are hashed at rest — if you lose one, revoke and mint a new one.
            </p>
            <CodeBlock prompt>workflow-manager auth login --token wm_...</CodeBlock>
          </aside>
        )}
      </div>

      <div className="panel panel--flush">
        <div className="panel-header" style={{ padding: "20px 24px", margin: 0 }}>
          <div className="stack-sm">
            <Eyebrow>Issued tokens</Eyebrow>
            <h2>Active access</h2>
          </div>
          <div className="cluster-sm">
            <Pill tone="ok">{activeCount} active</Pill>
            <Pill tone="muted">{tokens.data?.items.length ?? 0} total</Pill>
          </div>
        </div>

        {tokens.isLoading && (
          <div className="empty">
            <KeyRound size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
            <div className="muted">Loading tokens…</div>
          </div>
        )}
        {tokens.isError && (
          <div style={{ padding: "0 24px 24px" }}>
            <StatusBanner tone="err">{(tokens.error as Error).message}</StatusBanner>
          </div>
        )}
        {tokens.data && tokens.data.items.length === 0 && (
          <div className="empty" style={{ margin: "0 24px 24px" }}>
            <KeyRound size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
            <div className="empty__title">No tokens yet</div>
            <div className="muted">Mint your first token above.</div>
          </div>
        )}

        {tokens.data && tokens.data.items.length > 0 && (
          <div style={{ padding: "0 24px 8px" }}>
            {tokens.data.items.map((token) => (
              <article key={token.tokenId} className="wf-row">
                <div className="wf-row__meta">
                  <div className="cluster-sm">
                    <h3 className="wf-row__title" style={{ fontSize: 15 }}>
                      {token.name ?? token.tokenId}
                    </h3>
                    <Pill tone={token.active ? "ok" : "outline"}>{token.active ? "active" : "revoked"}</Pill>
                  </div>
                  <p className="wf-row__desc tabular" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    created {new Date(token.createdAt).toLocaleDateString()}
                    {" · "}last used{" "}
                    {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "never"}
                    {" · "}scopes {token.scopes.join(", ") || "—"}
                  </p>
                </div>
                <div className="wf-row__side">
                  {token.active && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      leading={<Trash2 size={12} strokeWidth={2} aria-hidden="true" />}
                      disabled={revokeTokenMutation.isPending}
                      onClick={() => void revokeTokenMutation.mutateAsync(token.tokenId)}
                    >
                      {revokeTokenMutation.isPending ? "Revoking…" : "Revoke"}
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

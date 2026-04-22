import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { ArrowUpRight, KeyRound, Package, Upload } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { fetchWhoAmI, fetchWorkflowAnalytics, refreshWorkflowAnalytics } from "../lib/remoteApi";
import { Button, LinkButton } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

export function DashboardPage() {
  const { loading, session } = useAuth();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ["profile", session?.access_token],
    queryFn: () => fetchWhoAmI(session!.access_token),
    enabled: Boolean(session?.access_token),
  });

  const analytics = useQuery({
    queryKey: ["workflow-analytics", session?.access_token],
    queryFn: () => fetchWorkflowAnalytics(session!.access_token),
    enabled: Boolean(session?.access_token),
  });

  const refreshAnalyticsMutation = useMutation({
    mutationFn: () => refreshWorkflowAnalytics(session!.access_token),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["workflow-analytics", session?.access_token] });
    },
  });

  const stats = useMemo(() => {
    const items = analytics.data?.items ?? [];
    const totalDownloads = items.reduce((sum, item) => sum + item.totalDownloads, 0);
    const lastPublishedAt = items
      .map((item) => item.lastDownloadedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const lastSevenDayDownloads = items.reduce((sum, item) => {
      return (
        sum +
        item.dailyStats
          .slice(0, 7)
          .reduce((itemSum, stat) => itemSum + Number((stat as Record<string, unknown>).downloads ?? 0), 0)
      );
    }, 0);

    return {
      count: items.length,
      totalDownloads,
      lastPublishedAt,
      lastSevenDayDownloads,
      activeCount: items.filter((item) => item.lastDownloadedAt).length,
    };
  }, [analytics.data]);

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

  const owner = profile.data?.username ?? "owner";

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>Dashboard</Eyebrow>
        <h1>Welcome back, {profile.data?.displayName ?? profile.data?.username ?? "creator"}.</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Mint CLI tokens, publish new workflow versions, and watch downloads across your registry content.
        </p>
      </div>

      <div className="stack stack-sm">
        <div className="kpi">
          <div className="kpi__card">
            <span className="kpi__label">Workflows</span>
            <span className="kpi__value">{stats.count}</span>
            <span className="kpi__hint">tracked in registry</span>
          </div>
          <div className="kpi__card">
            <span className="kpi__label">Downloads</span>
            <span className="kpi__value">{stats.totalDownloads}</span>
            <span className="kpi__hint">all-time pulls</span>
          </div>
          <div className="kpi__card">
            <span className="kpi__label">Last activity</span>
            <span className="kpi__value">
              {stats.lastPublishedAt ? new Date(stats.lastPublishedAt).toLocaleDateString() : "—"}
            </span>
            <span className="kpi__hint">most recent pull</span>
          </div>
          <div className="kpi__card">
            <span className="kpi__label">Handle</span>
            <span className="kpi__value" style={{ fontSize: 18 }}>{owner}</span>
            <span className="kpi__hint">your namespace</span>
          </div>
        </div>

        <div className="cluster between">
          <div className="cluster">
            <LinkButton
              to="/dashboard/publish"
              variant="primary"
              leading={<Upload size={14} strokeWidth={2} aria-hidden="true" />}
            >
              Publish a workflow
            </LinkButton>
            <LinkButton
              to="/dashboard/tokens"
              variant="ghost"
              leading={<KeyRound size={14} strokeWidth={2} aria-hidden="true" />}
            >
              Manage CLI tokens
            </LinkButton>
          </div>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => void refreshAnalyticsMutation.mutateAsync()}
            disabled={refreshAnalyticsMutation.isPending}
          >
            {refreshAnalyticsMutation.isPending ? "Refreshing analytics…" : "Refresh analytics"}
          </Button>
        </div>

        <p className="muted" style={{ fontSize: 13 }}>
          Last 7 days: {stats.lastSevenDayDownloads} downloads across {stats.activeCount} active workflow
          {stats.activeCount === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="panel stack">
        <div className="cluster between" style={{ flexWrap: "wrap", gap: "4px 24px" }}>
          <div className="stack-sm">
            <Eyebrow>CLI handoff</Eyebrow>
            <h2>Sign the CLI in</h2>
          </div>
          <p className="muted" style={{ fontSize: 13, alignSelf: "flex-end" }}>
            Mint a token below, then paste the command into any terminal.
          </p>
        </div>
        <CodeBlock prompt>{`workflow-manager auth login --token wm_...`}</CodeBlock>
      </div>

      <div className="panel panel--flush">
        <div className="panel-header" style={{ padding: "20px 24px", margin: 0 }}>
          <div className="stack-sm">
            <Eyebrow>Creator analytics</Eyebrow>
            <h2>Your workflows</h2>
          </div>
          <Pill tone="muted">{stats.count} tracked</Pill>
        </div>

        {analytics.isLoading && (
          <div className="empty">
            <Package size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
            <div className="muted">Loading analytics…</div>
          </div>
        )}
        {analytics.isError && (
          <div style={{ padding: "0 24px 24px" }}>
            <StatusBanner tone="err">{(analytics.error as Error).message}</StatusBanner>
          </div>
        )}
        {analytics.data && analytics.data.items.length === 0 && (
          <div className="empty" style={{ margin: "0 24px 24px" }}>
            <Package size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
            <div className="empty__title">No workflows yet</div>
            <div className="muted">Publish your first workflow from the CLI or from this dashboard.</div>
            <CodeBlock prompt>workflow-manager publish ./workflow.md --visibility public</CodeBlock>
          </div>
        )}

        {analytics.data && analytics.data.items.length > 0 && (
          <div style={{ padding: "0 24px 8px" }}>
            {analytics.data.items.map((item) => {
              const latestVersion = item.downloadsByVersion[0]?.version ?? "n/a";
              const lastPull = item.lastDownloadedAt
                ? new Date(item.lastDownloadedAt).toLocaleDateString()
                : "Never";
              return (
                <article key={item.slug} className="wf-row">
                  <div className="wf-row__meta">
                    <div className="cluster-sm">
                      <span className="wf-row__path tabular">{owner}/</span>
                      <h3 className="wf-row__title">{item.title}</h3>
                    </div>
                    <p className="wf-row__desc tabular" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {item.totalDownloads} pulls · latest {latestVersion} · last {lastPull}
                    </p>
                  </div>
                  <div className="wf-row__side">
                    <Pill tone={item.visibility === "public" ? "ok" : "outline"}>{item.visibility}</Pill>
                    <div className="cluster-sm">
                      <Link to={`/workflow/${owner}/${item.slug}`} className="btn btn--subtle btn--sm">
                        View
                        <ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
                      </Link>
                      <Link to={`/dashboard/workflows/${item.slug}`} className="btn btn--ghost btn--sm">
                        Manage
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

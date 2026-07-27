import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, KeyRound, LoaderCircle, Package, Search, Upload } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { latestAnalyticsVersion } from "../lib/workflowPublishing";
import { readFirstRunDismissed, writeFirstRunDismissed } from "../lib/firstRun";
import { fetchWhoAmI, fetchWorkflowAnalytics, fetchWorkflowRunInsights, refreshWorkflowAnalytics } from "../lib/remoteApi";
import { Button, LinkButton } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Eyebrow, Panel } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

export function DashboardPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);

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

  const runInsights = useQuery({
    queryKey: ["workflow-run-insights", session?.access_token],
    queryFn: () => fetchWorkflowRunInsights(session!.access_token),
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
    const lastDownloadedAt = items
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
      lastDownloadedAt,
      lastSevenDayDownloads,
      activeCount: items.filter((item) => item.lastDownloadedAt).length,
      latestDraftCount: items.filter((item) => latestAnalyticsVersion(item)?.publishedState === "draft").length,
    };
  }, [analytics.data]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setFirstRunDismissed(readFirstRunDismissed(window.localStorage));
  }, []);

  function dismissFirstRunPanel() {
    if (typeof window === "undefined") {
      return;
    }

    writeFirstRunDismissed(window.localStorage, true);
    setFirstRunDismissed(true);
  }

  const showFirstRunPanel = !firstRunDismissed && analytics.isSuccess && stats.count === 0;
  const owner = profile.data?.username ?? profile.data?.userId ?? "owner";

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>Dashboard</Eyebrow>
        <h1>
          {profile.isLoading
            ? "Your workflow workspace"
            : `Welcome back, ${profile.data?.displayName ?? profile.data?.username ?? profile.data?.userId ?? "creator"}.`}
        </h1>
        <p className="muted page-lede">
          Mint CLI tokens, publish new workflow versions, and watch downloads across your registry content.
        </p>
      </div>

      {profile.isError && <StatusBanner tone="err">{(profile.error as Error).message}</StatusBanner>}

      {showFirstRunPanel && (
        <Panel className="stack onboarding-panel">
          <div className="section-heading">
            <div className="stack-sm">
              <Eyebrow>First run</Eyebrow>
              <h2>Choose your next action</h2>
            </div>
            <Button type="button" variant="subtle" size="sm" onClick={dismissFirstRunPanel}>
              Dismiss
            </Button>
          </div>

          <div className="grid-3">
            <article className="card stack-sm">
              <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>Publish a workflow</h3>
              <p className="muted">Open the browser editor and ship your first version.</p>
              <LinkButton to="/dashboard/publish" variant="primary">
                Start publishing
              </LinkButton>
            </article>

            <article className="card stack-sm">
              <Search size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>Browse public workflows</h3>
              <p className="muted">Explore existing workflows and pull one into your repo.</p>
              <LinkButton to="/search" variant="ghost">
                Browse registry
              </LinkButton>
            </article>

            <article className="card stack-sm">
              <KeyRound size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>Get a CLI token</h3>
              <p className="muted">Mint a token so you can publish directly from your terminal.</p>
              <LinkButton to="/dashboard/tokens" variant="ghost">
                Create token
              </LinkButton>
            </article>
          </div>
        </Panel>
      )}

      <section className="stack">
        <div className="kpi" aria-busy={analytics.isLoading}>
          <div className="kpi__card">
            <span className="kpi__label">Workflows</span>
            <span className="kpi__value">{analytics.isLoading ? "—" : stats.count}</span>
            <span className="kpi__hint">tracked in registry</span>
          </div>
          <div className="kpi__card">
            <span className="kpi__label">Downloads</span>
            <span className="kpi__value">{analytics.isLoading ? "—" : stats.totalDownloads}</span>
            <span className="kpi__hint">all-time pulls</span>
          </div>
          <div className="kpi__card">
            <span className="kpi__label">Last activity</span>
            <span className="kpi__value">
              {!analytics.isLoading && stats.lastDownloadedAt
                ? new Date(stats.lastDownloadedAt).toLocaleDateString()
                : "—"}
            </span>
            <span className="kpi__hint">most recent pull</span>
          </div>
          <div className="kpi__card">
            <span className="kpi__label">Handle</span>
            <span className="kpi__value kpi__value--handle">{profile.isLoading ? "—" : owner}</span>
            <span className="kpi__hint">your namespace</span>
          </div>
        </div>

        <div className="dashboard-actions">
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

        <p className="muted dashboard-summary">
          Last 7 days: {stats.lastSevenDayDownloads} downloads across {stats.activeCount} active workflow
          {stats.activeCount === 1 ? "" : "s"}.
        </p>
        {refreshAnalyticsMutation.isError && (
          <StatusBanner tone="err">{(refreshAnalyticsMutation.error as Error).message}</StatusBanner>
        )}
        {stats.latestDraftCount > 0 && (
          <StatusBanner tone="warn">
            {stats.latestDraftCount} workflow{stats.latestDraftCount === 1 ? " has" : "s have"} a latest draft. Public users still pull the last published version until you publish those updates.
          </StatusBanner>
        )}
      </section>

      <div className="panel stack">
        <div className="section-heading">
          <div className="stack-sm">
            <Eyebrow>CLI handoff</Eyebrow>
            <h2>Sign the CLI in</h2>
          </div>
          <p className="muted section-heading__aside">
            Mint a token below, then paste the command into any terminal.
          </p>
        </div>
        <CodeBlock prompt>{`workflow-manager auth login --token wm_...`}</CodeBlock>
      </div>

      <div className="panel panel--flush">
        <div className="panel-header panel-header--flush">
          <div className="stack-sm">
            <Eyebrow>Creator analytics</Eyebrow>
            <h2>Your workflows</h2>
          </div>
          <Pill tone="muted">{stats.count} tracked</Pill>
        </div>

        {analytics.isLoading && (
          <div className="state-surface" role="status">
            <LoaderCircle size={20} strokeWidth={1.75} className="state-surface__spinner" aria-hidden="true" />
            <div className="empty__title">Loading your workflows</div>
            <div className="muted">Fetching the latest registry analytics…</div>
          </div>
        )}
        {analytics.isError && (
          <div className="panel-state">
            <StatusBanner tone="err">{(analytics.error as Error).message}</StatusBanner>
          </div>
        )}
        {analytics.data && analytics.data.items.length === 0 && (
          <div className="empty panel-state">
            <Package size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
            <div className="empty__title">No workflows yet</div>
            <div className="muted">Publish your first workflow from the CLI or from this dashboard.</div>
            <CodeBlock prompt>workflow-manager publish ./workflow.md --visibility public</CodeBlock>
            <LinkButton to="/dashboard/publish" variant="primary">
              Publish your first workflow
            </LinkButton>
          </div>
        )}

        {analytics.data && analytics.data.items.length > 0 && (
          <div className="panel-list">
            {analytics.data.items.map((item) => {
              const latestVersion = latestAnalyticsVersion(item);
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
                      {item.totalDownloads} pulls · latest {latestVersion?.version ?? "n/a"} · last {lastPull}
                    </p>
                    {latestVersion?.publishedState === "draft" && (
                      <p className="wf-row__desc" style={{ color: "var(--warn)", fontWeight: 600 }}>
                        Draft update pending - public users still see the previously published version.
                      </p>
                    )}
                  </div>
                  <div className="wf-row__side">
                    <Pill tone={item.visibility === "public" ? "ok" : "outline"}>{item.visibility}</Pill>
                    {latestVersion && (
                      <Pill tone={latestVersion.publishedState === "published" ? "ok" : "warn"}>
                        latest {latestVersion.publishedState}
                      </Pill>
                    )}
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

      <div className="panel panel--flush">
        <div className="panel-header panel-header--flush">
          <div className="stack-sm">
            <Eyebrow>Authenticated CLI telemetry</Eyebrow>
            <h2>Your workflow effectiveness</h2>
          </div>
          <Pill tone="muted">{runInsights.data?.items.length ?? 0} workflows</Pill>
        </div>

        {runInsights.isLoading && (
          <div className="state-surface" role="status">
            <LoaderCircle size={20} strokeWidth={1.75} className="state-surface__spinner" aria-hidden="true" />
            <div className="empty__title">Loading run insights</div>
            <div className="muted">Turning authenticated CLI runs into workflow signals…</div>
          </div>
        )}
        {runInsights.isError && (
          <div className="panel-state">
            <StatusBanner tone="err">{(runInsights.error as Error).message}</StatusBanner>
          </div>
        )}
        {runInsights.data && runInsights.data.items.length === 0 && (
          <div className="empty panel-state">
            <Package size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
            <div className="empty__title">No authenticated run telemetry yet</div>
            <div className="muted">Run a workflow from the authenticated CLI to measure success, failure, and effectiveness.</div>
            <CodeBlock prompt>workflow-manager run ./workflow.json --auto-confirm-all</CodeBlock>
          </div>
        )}

        {runInsights.data && runInsights.data.items.length > 0 && (
          <div className="panel-list">
            {runInsights.data.items.map((item) => (
              <article key={item.workflowKey} className="wf-row">
                <div className="wf-row__meta">
                  <div className="cluster-sm">
                    <span className="wf-row__path tabular">{item.workflowKey}</span>
                    <h3 className="wf-row__title">{item.workflowTitle ?? item.workflowKey}</h3>
                  </div>
                  <p className="wf-row__desc tabular" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {item.totalRuns} runs · {item.successRate}% success · avg effectiveness {item.averageEffectiveness}
                  </p>
                  <div className="cluster-sm">
                    <Pill tone="ok">Succeeded: {item.successfulRuns}</Pill>
                    <Pill tone={item.failedRuns > 0 ? "err" : "muted"}>Failed: {item.failedRuns}</Pill>
                    <Pill tone={item.approvalRuns > 0 ? "warn" : "muted"}>Needs approval: {item.approvalRuns}</Pill>
                  </div>
                </div>
                <div className="wf-row__side">
                  <Pill tone="outline">{Math.round(item.averageDurationMs / 1000)}s avg</Pill>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Last run {item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : "—"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

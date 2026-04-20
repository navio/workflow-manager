import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchWhoAmI, fetchWorkflowAnalytics } from "../lib/remoteApi";

export function DashboardPage() {
  const { loading, session } = useAuth();

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

  const cliSnippet = useMemo(() => {
    if (!session?.access_token) {
      return "workflow-manager auth login --token <create-a-cli-token-in-the-dashboard>";
    }

    return "Create a CLI token in the Tokens tab, then run: workflow-manager auth login --token <token>";
  }, [session]);

  if (loading) {
    return <section className="panel">Checking session...</section>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <section className="stack page-grid">
      <div className="panel">
        <p className="eyebrow">Authenticated session</p>
        <h2>Dashboard</h2>
        <p>
          {profile.data?.displayName ?? profile.data?.username ?? "Signed in"} can mint CLI tokens, publish workflows, and track analytics for
          registry content here.
        </p>
      </div>
      <div className="panel">
        <h3>CLI handoff</h3>
        <code>{cliSnippet}</code>
        <div className="meta-row">
          <Link to="/dashboard/publish">Publish from the dashboard</Link>
          <Link to="/dashboard/tokens">Manage CLI tokens</Link>
        </div>
      </div>

      <div className="panel">
        <div className="workflow-card__header">
          <div>
            <p className="eyebrow">Creator analytics</p>
            <h3>Your workflows</h3>
          </div>
          <span className="pill">{analytics.data?.items.length ?? 0} tracked</span>
        </div>

        {analytics.isLoading && <p>Loading workflow analytics...</p>}
        {analytics.isError && <div className="banner error">{(analytics.error as Error).message}</div>}
        {analytics.data && analytics.data.items.length === 0 && <p>No published workflows yet. Use the CLI to publish the first one.</p>}

        <div className="stack compact">
          {analytics.data?.items.map((item) => (
            <article key={item.slug} className="panel inset-panel">
              <div className="workflow-card__header">
                <div>
                  <h3>{item.title}</h3>
                  <p className="eyebrow">{item.slug}</p>
                </div>
                <span className="pill muted">{item.visibility}</span>
              </div>
              <div className="stats-grid">
                <div>
                  <strong>{item.totalDownloads}</strong>
                  <span>Total downloads</span>
                </div>
                <div>
                  <strong>{item.downloadsByVersion[0]?.version ?? "n/a"}</strong>
                  <span>Latest version</span>
                </div>
                <div>
                  <strong>{item.lastDownloadedAt ? new Date(item.lastDownloadedAt).toLocaleDateString() : "Never"}</strong>
                  <span>Last downloaded</span>
                </div>
              </div>
              <code>{`workflow-manager pull ${profile.data?.username ?? "owner"}/${item.slug}`}</code>
              <div className="meta-row">
                <Link to={`/workflow/${profile.data?.username ?? "owner"}/${item.slug}`}>Open detail page</Link>
                <Link to={`/dashboard/workflows/${item.slug}`}>Manage workflow</Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

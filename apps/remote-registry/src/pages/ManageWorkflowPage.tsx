import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchManagedWorkflow, updateManagedWorkflow } from "../lib/remoteApi";

export function ManageWorkflowPage() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug = "" } = useParams();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workflow = useQuery({
    queryKey: ["managed-workflow", session?.access_token, slug],
    queryFn: () => fetchManagedWorkflow(session!.access_token, slug),
    enabled: Boolean(session?.access_token && slug),
  });

  useEffect(() => {
    if (workflow.data) {
      setTitle(workflow.data.title);
      setDescription(workflow.data.description ?? "");
      setVisibility(workflow.data.visibility === "public" ? "public" : "private");
    }
  }, [workflow.data]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateManagedWorkflow(session!.access_token, {
        slug,
        title,
        description,
        visibility,
      }),
    onSuccess(updated) {
      setMessage(`Saved ${updated.slug}`);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["managed-workflow", session?.access_token, slug] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-analytics", session?.access_token] });
    },
    onError(mutationError) {
      setError((mutationError as Error).message);
      setMessage(null);
    },
  });

  if (loading) {
    return <section className="panel">Checking session...</section>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  if (workflow.isLoading) {
    return <section className="panel">Loading workflow management view...</section>;
  }

  if (workflow.isError || !workflow.data) {
    return <section className="panel error">{workflow.error instanceof Error ? workflow.error.message : "Workflow not found"}</section>;
  }

  return (
    <section className="stack page-grid">
      <div className="panel workflow-card__header">
        <div>
          <p className="eyebrow">Workflow management</p>
          <h2>{workflow.data.title}</h2>
          <p>{workflow.data.slug}</p>
        </div>
        <div className="meta-row">
          <span className="pill">{workflow.data.visibility}</span>
          <Link to={`/dashboard/publish/${workflow.data.slug}`}>Publish new version</Link>
        </div>
      </div>

      <div className="publish-grid">
        <form
          className="panel stack"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void updateMutation.mutateAsync();
          }}
        >
          <label className="stack compact">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="stack compact">
            <span>Description</span>
            <textarea rows={8} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="stack compact">
            <span>Visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "private")}> 
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
          </label>
          <button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save workflow settings"}
          </button>
          {message && <div className="banner success">{message}</div>}
          {error && <div className="banner error">{error}</div>}
        </form>

        <aside className="panel stack">
          <div>
            <p className="eyebrow">Tags</p>
            <div className="meta-row">
              {(workflow.data.latestTags.length > 0 ? workflow.data.latestTags : ["untagged"]).map((tag) => (
                <span key={tag} className="pill muted">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="stack compact">
            <p className="eyebrow">Version history</p>
            {workflow.data.versions.map((version) => (
              <article key={version.id} className="panel inset-panel token-row">
                <div className="workflow-card__header">
                  <div>
                    <h3>{version.version}</h3>
                    <p className="eyebrow">{version.sourceFormat}</p>
                  </div>
                  <span className={`pill ${version.isLatest ? "" : "muted"}`}>{version.isLatest ? "Latest" : version.publishedState}</span>
                </div>
                <div className="stats-grid">
                  <div>
                    <strong>{new Date(version.createdAt).toLocaleDateString()}</strong>
                    <span>Created</span>
                  </div>
                  <div>
                    <strong>{version.publishedState}</strong>
                    <span>State</span>
                  </div>
                  <div>
                    <strong>{version.changelog ?? "No changelog"}</strong>
                    <span>Change note</span>
                  </div>
                </div>
                <code>{version.rawSource.slice(0, 180)}{version.rawSource.length > 180 ? "..." : ""}</code>
              </article>
            ))}
          </div>
        </aside>
      </div>

      <button className="ghost-button align-start" onClick={() => void navigate("/dashboard")}>
        Back to dashboard
      </button>
    </section>
  );
}

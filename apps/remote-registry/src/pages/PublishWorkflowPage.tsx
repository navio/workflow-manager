import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchManagedWorkflow, publishWorkflow } from "../lib/remoteApi";
import { parseWorkflowSource } from "../lib/workflowSource";

const starterSource = `{
  "key": "workflow-key",
  "title": "Workflow Title",
  "steps": [
    {
      "key": "first_step",
      "kind": "task",
      "taskSpec": {
        "adapterKey": "mock",
        "payload": {
          "mockResult": "success"
        }
      }
    }
  ]
}`;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function PublishWorkflowPage() {
  const { loading, session } = useAuth();
  const { slug: managedSlug } = useParams();
  const queryClient = useQueryClient();
  const [rawSource, setRawSource] = useState(starterSource);
  const [description, setDescription] = useState("Published from the remote registry dashboard");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [versionLabel, setVersionLabel] = useState("v1");
  const [tags, setTags] = useState("example,dashboard");
  const [changelog, setChangelog] = useState("Initial dashboard publish");
  const [publishedState, setPublishedState] = useState<"draft" | "published">("published");
  const [error, setError] = useState<string | null>(null);

  const managedWorkflow = useQuery({
    queryKey: ["managed-workflow", session?.access_token, managedSlug],
    queryFn: () => fetchManagedWorkflow(session!.access_token, managedSlug!),
    enabled: Boolean(session?.access_token && managedSlug),
  });

  useEffect(() => {
    if (!managedWorkflow.data) {
      return;
    }

    setDescription(managedWorkflow.data.description ?? "");
    setVisibility(managedWorkflow.data.visibility === "public" ? "public" : "private");
    setTags(managedWorkflow.data.latestTags.join(","));
    const latestVersion = managedWorkflow.data.versions.find((version) => version.isLatest) ?? managedWorkflow.data.versions[0];
    if (latestVersion) {
      setVersionLabel(`${latestVersion.version}-next`);
      setChangelog(`Update ${managedWorkflow.data.slug}`);
      setRawSource(latestVersion.rawSource);
    }
  }, [managedWorkflow.data]);

  const parsed = useMemo(() => {
    try {
      return parseWorkflowSource(rawSource);
    } catch {
      return null;
    }
  }, [rawSource]);

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!session) {
        throw new Error("You must be signed in to publish a workflow");
      }
      const parsedSource = parseWorkflowSource(rawSource);
      return publishWorkflow(session.access_token, {
        slug: managedSlug ?? slugify(parsedSource.definition.key),
        title: parsedSource.definition.title,
        description,
        visibility,
        versionLabel,
        sourceFormat: parsedSource.sourceFormat,
        rawSource,
        definition: parsedSource.definition,
        tags: tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        changelog,
        publishedState,
      });
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["workflow-analytics", session?.access_token] });
      setError(null);
    },
    onError(mutationError) {
      setError((mutationError as Error).message);
    },
  });

  if (loading) {
    return <section className="panel">Checking session...</section>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <section className="stack page-grid">
      <div className="panel">
        <p className="eyebrow">Publish workflow</p>
        <h2>Publish a registry workflow</h2>
        <p>
          {managedSlug
            ? `Publishing a new version for ${managedSlug}. The latest workflow source is preloaded for editing.`
            : "Paste a JSON or Markdown workflow definition. The app parses it, extracts the workflow metadata, and publishes the raw source."}
        </p>
      </div>

      <div className="publish-grid">
        <form
          className="panel stack"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void publishMutation.mutateAsync();
          }}
        >
          <label className="stack compact">
            <span>Description</span>
            <input name="workflow-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="form-grid">
            <label className="stack compact">
              <span>Visibility</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "private")}> 
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </label>
            <label className="stack compact">
              <span>Version label</span>
              <input name="version-label" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} />
            </label>
          </div>
          <label className="stack compact">
            <span>Tags</span>
            <input name="workflow-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="example,dashboard" />
          </label>
          <label className="stack compact">
            <span>Changelog</span>
            <input name="workflow-changelog" value={changelog} onChange={(event) => setChangelog(event.target.value)} />
          </label>
          <label className="stack compact">
            <span>Published state</span>
            <select value={publishedState} onChange={(event) => setPublishedState(event.target.value as "draft" | "published")}> 
              <option value="published">published</option>
              <option value="draft">draft</option>
            </select>
          </label>
          <label className="stack compact">
            <span>Workflow source</span>
            <textarea name="workflow-source" value={rawSource} onChange={(event) => setRawSource(event.target.value)} rows={22} />
          </label>
          <button type="submit" disabled={publishMutation.isPending}>
            {publishMutation.isPending ? "Publishing workflow..." : "Publish workflow"}
          </button>
          {error && <div className="banner error">{error}</div>}
          {publishMutation.data && (
            <div className="banner success">
              Published <strong>{publishMutation.data.slug}</strong> as {publishMutation.data.version}.{" "}
              <Link to="/dashboard">Return to dashboard</Link>
            </div>
          )}
        </form>

        <aside className="panel stack">
          <div>
            <p className="eyebrow">Parsed preview</p>
            <h3>{parsed?.definition.title ?? "Waiting for valid workflow"}</h3>
            <p>{parsed ? `${parsed.definition.steps.length} steps detected` : "Fix the source to preview metadata."}</p>
          </div>
          {parsed && (
            <>
              <div className="stats-grid">
                <div>
                  <strong>{parsed.definition.key}</strong>
                  <span>Workflow key</span>
                </div>
                <div>
                  <strong>{parsed.sourceFormat}</strong>
                  <span>Source format</span>
                </div>
                <div>
                  <strong>{slugify(parsed.definition.key)}</strong>
                  <span>Remote slug</span>
                </div>
              </div>
              <div className="stack compact">
                {parsed.definition.steps.map((step, index) => (
                  <div key={`${String(step.key ?? index)}`} className="panel inset-panel">
                    <strong>{String(step.key ?? `step-${index + 1}`)}</strong>
                    <span className="eyebrow">{String(step.kind ?? "task")}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

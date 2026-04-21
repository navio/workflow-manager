import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { FileCode2, Rocket, Sparkles } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { fetchManagedWorkflow, publishWorkflow } from "../lib/remoteApi";
import { parseWorkflowSource } from "../lib/workflowSource";
import type { ManagedWorkflow } from "../types";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

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

interface PublishFormState {
  rawSource: string;
  description: string;
  visibility: "public" | "private";
  versionLabel: string;
  tags: string;
  changelog: string;
  publishedState: "draft" | "published";
}

interface PublishWorkflowFormProps {
  accessToken: string;
  managedSlug?: string;
  initialState: PublishFormState;
}

function defaultPublishFormState(): PublishFormState {
  return {
    rawSource: starterSource,
    description: "Published from the remote registry dashboard",
    visibility: "public",
    versionLabel: "v1",
    tags: "example,dashboard",
    changelog: "Initial dashboard publish",
    publishedState: "published",
  };
}

function managedPublishFormState(workflow: ManagedWorkflow): PublishFormState {
  const latestVersion = workflow.versions.find((version) => version.isLatest) ?? workflow.versions[0];
  return {
    rawSource: latestVersion?.rawSource ?? starterSource,
    description: workflow.description ?? "",
    visibility: workflow.visibility === "public" ? "public" : "private",
    versionLabel: latestVersion ? `${latestVersion.version}-next` : "v1",
    tags: workflow.latestTags.join(","),
    changelog: `Update ${workflow.slug}`,
    publishedState: "published",
  };
}

function PublishWorkflowForm({ accessToken, managedSlug, initialState }: PublishWorkflowFormProps) {
  const queryClient = useQueryClient();
  const [rawSource, setRawSource] = useState(initialState.rawSource);
  const [description, setDescription] = useState(initialState.description);
  const [visibility, setVisibility] = useState(initialState.visibility);
  const [versionLabel, setVersionLabel] = useState(initialState.versionLabel);
  const [tags, setTags] = useState(initialState.tags);
  const [changelog, setChangelog] = useState(initialState.changelog);
  const [publishedState, setPublishedState] = useState(initialState.publishedState);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return parseWorkflowSource(rawSource);
    } catch {
      return null;
    }
  }, [rawSource]);

  const lineCount = rawSource.split("\n").length;

  const publishMutation = useMutation({
    mutationFn: () => {
      const parsedSource = parseWorkflowSource(rawSource);
      return publishWorkflow(accessToken, {
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
      void queryClient.invalidateQueries({ queryKey: ["workflow-analytics", accessToken] });
      setError(null);
    },
    onError(mutationError) {
      setError((mutationError as Error).message);
    },
  });

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>Dashboard / publish{managedSlug ? ` / ${managedSlug}` : ""}</Eyebrow>
        <h1>{managedSlug ? "Publish new version" : "Publish a workflow"}</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {managedSlug
            ? `Publishing a new version for ${managedSlug}. The latest source is preloaded below.`
            : "Paste a JSON or Markdown workflow definition. The inspector parses it live — no round-trip to the server."}
        </p>
      </div>

      <form
        className="stack-lg"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void publishMutation.mutateAsync();
        }}
      >
        <div className="grid-publish">
          <div className="source" aria-label="Workflow source editor">
            <div className="source__head">
              <span className="cluster-sm">
                <FileCode2 size={12} strokeWidth={2} aria-hidden="true" />
                <span>workflow.{parsed?.sourceFormat ?? "json"}</span>
              </span>
              <span className="tabular">{lineCount} lines</span>
            </div>
            <textarea
              name="workflow-source"
              value={rawSource}
              onChange={(event) => setRawSource(event.target.value)}
              rows={24}
              style={{
                width: "100%",
                border: 0,
                borderRadius: 0,
                background: "var(--code-bg)",
                color: "#E8EBE5",
                padding: "14px 16px",
                boxShadow: "none",
                resize: "vertical",
              }}
              spellCheck={false}
            />
          </div>

          <aside className="panel stack">
            <div className="cluster between">
              <div className="stack-sm">
                <Eyebrow>Inspector</Eyebrow>
                <h2>{parsed?.definition.title ?? "Awaiting valid source"}</h2>
              </div>
              <Pill tone={parsed ? "ok" : "warn"} leading={<Sparkles size={12} strokeWidth={2} aria-hidden="true" />}>
                {parsed ? "valid" : "invalid"}
              </Pill>
            </div>

            {parsed ? (
              <>
                <dl className="meta">
                  <dt>Key</dt>
                  <dd>{parsed.definition.key}</dd>
                  <dt>Format</dt>
                  <dd>{parsed.sourceFormat}</dd>
                  <dt>Slug</dt>
                  <dd>{slugify(parsed.definition.key)}</dd>
                  <dt>Steps</dt>
                  <dd className="tabular">{parsed.definition.steps.length}</dd>
                </dl>

                <div className="stack-sm">
                  <Eyebrow>Steps</Eyebrow>
                  <div className="stack" style={{ gap: 6 }}>
                    {parsed.definition.steps.map((step, index) => (
                      <div
                        key={`${String(step.key ?? index)}`}
                        className="card cluster between"
                        style={{ padding: "10px 12px" }}
                      >
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                          {String(step.key ?? `step-${index + 1}`)}
                        </span>
                        <Pill tone="muted">{String(step.kind ?? "task")}</Pill>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>
                The editor content isn't valid JSON or Markdown yet. Fix the source to see parsed metadata here.
              </p>
            )}
          </aside>
        </div>

        <div className="panel stack">
          <Eyebrow>Publish settings</Eyebrow>
          <div className="grid-2">
            <Field label="Description">
              <input
                name="workflow-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Version label" required>
              <input
                name="version-label"
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                required
              />
            </Field>
            <Field label="Visibility">
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as "public" | "private")}
              >
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </Field>
            <Field label="Published state">
              <select
                value={publishedState}
                onChange={(event) => setPublishedState(event.target.value as "draft" | "published")}
              >
                <option value="published">published</option>
                <option value="draft">draft</option>
              </select>
            </Field>
            <Field label="Tags" hint="Comma-separated.">
              <input
                name="workflow-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="example,dashboard"
              />
            </Field>
            <Field label="Changelog">
              <input
                name="workflow-changelog"
                value={changelog}
                onChange={(event) => setChangelog(event.target.value)}
              />
            </Field>
          </div>
        </div>

        {error && <StatusBanner tone="err">{error}</StatusBanner>}
        {publishMutation.data && (
          <StatusBanner tone="ok">
            Published <strong>{publishMutation.data.slug}</strong> as {publishMutation.data.version}.{" "}
            <Link to="/dashboard">Return to dashboard</Link>
          </StatusBanner>
        )}

        <div className="sticky-bar">
          <span className="muted" style={{ marginRight: "auto", alignSelf: "center", fontSize: 13 }}>
            {parsed
              ? `Ready to publish ${slugify(parsed.definition.key)} @ ${versionLabel}`
              : "Fix the source before publishing"}
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={publishMutation.isPending || !parsed}
            leading={<Rocket size={14} strokeWidth={2} aria-hidden="true" />}
          >
            {publishMutation.isPending ? "Publishing…" : "Publish workflow"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function PublishWorkflowPage() {
  const { loading, session } = useAuth();
  const { slug: managedSlug } = useParams();
  const managedWorkflow = useQuery({
    queryKey: ["managed-workflow", session?.access_token, managedSlug],
    queryFn: () => fetchManagedWorkflow(session!.access_token, managedSlug!),
    enabled: Boolean(session?.access_token && managedSlug),
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

  if (managedSlug && managedWorkflow.isLoading) {
    return (
      <div className="stack-lg">
        <Eyebrow>Dashboard / publish / {managedSlug}</Eyebrow>
        <p className="muted">Loading workflow…</p>
      </div>
    );
  }

  if (managedSlug && (managedWorkflow.isError || !managedWorkflow.data)) {
    return (
      <div className="stack-lg">
        <Eyebrow>Dashboard / publish / {managedSlug}</Eyebrow>
        <StatusBanner tone="err">
          {managedWorkflow.error instanceof Error ? managedWorkflow.error.message : "Workflow not found"}
        </StatusBanner>
      </div>
    );
  }

  const initialState =
    managedSlug && managedWorkflow.data
      ? managedPublishFormState(managedWorkflow.data)
      : defaultPublishFormState();

  return (
    <PublishWorkflowForm
      key={managedSlug ?? "new"}
      accessToken={session.access_token}
      managedSlug={managedSlug}
      initialState={initialState}
    />
  );
}

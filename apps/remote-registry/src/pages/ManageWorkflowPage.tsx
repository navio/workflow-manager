import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, History, Rocket } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { fetchManagedWorkflow, updateManagedWorkflow } from "../lib/remoteApi";
import type { ManagedWorkflow } from "../types";
import { Button, LinkButton } from "../ui/Button";
import { Field } from "../ui/Field";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

interface ManageWorkflowEditorProps {
  workflow: ManagedWorkflow;
  accessToken: string;
}

function ManageWorkflowEditor({ workflow, accessToken }: ManageWorkflowEditorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(workflow.title);
  const [description, setDescription] = useState(workflow.description ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    workflow.visibility === "public" ? "public" : "private"
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateManagedWorkflow(accessToken, {
        slug: workflow.slug,
        title,
        description,
        visibility,
      }),
    onSuccess(updated) {
      setMessage(`Saved ${updated.slug}`);
      setError(null);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["managed-workflow", accessToken, workflow.slug] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-analytics", accessToken] });
    },
    onError(mutationError) {
      setError((mutationError as Error).message);
      setMessage(null);
    },
  });

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>
          Dashboard / manage / <span className="tabular">{workflow.slug}</span>
        </Eyebrow>
        <div className="cluster between" style={{ alignItems: "flex-start" }}>
          <div className="stack-sm">
            <h1>{workflow.title}</h1>
            <div className="cluster-sm">
              <Pill tone={workflow.visibility === "public" ? "ok" : "outline"}>{workflow.visibility}</Pill>
              {workflow.latestTags.slice(0, 4).map((tag) => (
                <Pill key={tag} tone="muted">
                  {tag}
                </Pill>
              ))}
            </div>
          </div>
          <LinkButton
            to={`/dashboard/publish/${workflow.slug}`}
            variant="primary"
            leading={<Rocket size={14} strokeWidth={2} aria-hidden="true" />}
          >
            Publish new version
          </LinkButton>
        </div>
      </div>

      <div className="grid-publish">
        <form
          className="panel stack"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void updateMutation.mutateAsync();
          }}
        >
          <Eyebrow>Metadata</Eyebrow>
          <Field label="Title" required>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setDirty(true);
              }}
              required
            />
          </Field>
          <Field
            label="Description"
            hint="Markdown not supported here — this is the listing blurb on the registry."
          >
            <textarea
              rows={6}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Visibility">
            <select
              value={visibility}
              onChange={(event) => {
                setVisibility(event.target.value as "public" | "private");
                setDirty(true);
              }}
            >
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
          </Field>

          {message && <StatusBanner tone="ok">{message}</StatusBanner>}
          {error && <StatusBanner tone="err">{error}</StatusBanner>}
        </form>

        <aside className="panel stack">
          <div className="cluster between">
            <div className="stack-sm">
              <Eyebrow>Version history</Eyebrow>
              <h2>Timeline</h2>
            </div>
            <Pill tone="muted" leading={<History size={12} strokeWidth={2} aria-hidden="true" />}>
              {workflow.versions.length} versions
            </Pill>
          </div>

          <div className="timeline">
            {workflow.versions.map((version) => (
              <div
                key={version.id}
                className={`timeline__item ${version.isLatest ? "" : "timeline__item--old"}`}
              >
                <span className="timeline__dot" />
                <div className="stack-sm">
                  <div className="cluster-sm">
                    <span className="tabular" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                      {version.version}
                    </span>
                    <Pill tone={version.isLatest ? "ok" : "outline"}>
                      {version.isLatest ? "latest" : version.publishedState}
                    </Pill>
                    <span className="muted tabular" style={{ fontSize: 12 }}>
                      {new Date(version.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="muted" style={{ fontSize: 13 }}>
                    {version.changelog ?? "No changelog."}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {dirty && (
        <div className="sticky-bar">
          <span className="muted" style={{ marginRight: "auto", alignSelf: "center", fontSize: 13 }}>
            Unsaved changes
          </span>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setTitle(workflow.title);
              setDescription(workflow.description ?? "");
              setVisibility(workflow.visibility === "public" ? "public" : "private");
              setDirty(false);
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={updateMutation.isPending}
            onClick={() => void updateMutation.mutateAsync()}
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        leading={<ArrowLeft size={12} strokeWidth={2} aria-hidden="true" />}
        onClick={() => void navigate("/dashboard")}
        style={{ alignSelf: "flex-start" }}
      >
        Back to dashboard
      </Button>
    </div>
  );
}

export function ManageWorkflowPage() {
  const { loading, session } = useAuth();
  const { slug = "" } = useParams();
  const workflow = useQuery({
    queryKey: ["managed-workflow", session?.access_token, slug],
    queryFn: () => fetchManagedWorkflow(session!.access_token, slug),
    enabled: Boolean(session?.access_token && slug),
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

  if (workflow.isLoading) {
    return (
      <div className="stack-lg">
        <Eyebrow>Dashboard / manage</Eyebrow>
        <p className="muted">Loading workflow…</p>
      </div>
    );
  }

  if (workflow.isError || !workflow.data) {
    return (
      <div className="stack-lg">
        <Eyebrow>Dashboard / manage</Eyebrow>
        <StatusBanner tone="err">
          {workflow.error instanceof Error ? workflow.error.message : "Workflow not found"}
        </StatusBanner>
      </div>
    );
  }

  return (
    <ManageWorkflowEditor
      key={workflow.data.slug}
      workflow={workflow.data}
      accessToken={session.access_token}
    />
  );
}

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { FileCode2, Hash } from "lucide-react";
import { getWorkflow } from "../lib/remoteApi";
import { CodeBlock } from "../ui/CodeBlock";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

export function WorkflowDetailPage() {
  const { owner = "", slug = "" } = useParams();
  const workflow = useQuery({
    queryKey: ["workflow", owner, slug],
    queryFn: () => getWorkflow(owner, slug),
    enabled: Boolean(owner && slug),
  });

  if (workflow.isLoading) {
    return (
      <div className="stack-lg">
        <Eyebrow>Registry / workflow</Eyebrow>
        <div className="empty">
          <FileCode2 size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
          <div className="muted">Fetching {owner}/{slug}…</div>
        </div>
      </div>
    );
  }

  if (workflow.isError || !workflow.data) {
    return (
      <div className="stack-lg">
        <Eyebrow>Registry / workflow</Eyebrow>
        <StatusBanner tone="err">
          {workflow.error instanceof Error ? workflow.error.message : "Workflow not found"}
        </StatusBanner>
      </div>
    );
  }

  const wf = workflow.data;
  const pullCmd = `workflow-manager pull ${wf.owner}/${wf.slug}`;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Eyebrow>
          Registry / <span className="tabular">{wf.owner}</span> / <span className="tabular">{wf.slug}</span>
        </Eyebrow>
        <h1>{wf.title}</h1>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {wf.description ?? "No description provided."}
        </p>
      </div>

      <div className="grid-detail">
        <aside className="stack">
          <div className="panel stack">
            <dl className="meta">
              <dt>Owner</dt>
              <dd className="tabular">{wf.owner}</dd>
              <dt>Slug</dt>
              <dd className="tabular">{wf.slug}</dd>
              <dt>Version</dt>
              <dd className="tabular">{wf.version}</dd>
              <dt>Format</dt>
              <dd className="tabular">{wf.sourceFormat}</dd>
              <dt>Visibility</dt>
              <dd>
                <Pill tone={wf.visibility === "public" ? "ok" : "outline"}>{wf.visibility}</Pill>
              </dd>
            </dl>
          </div>

          <div className="panel stack">
            <Eyebrow>Pull from CLI</Eyebrow>
            <CodeBlock prompt>{pullCmd}</CodeBlock>
            <p className="muted" style={{ fontSize: 13 }}>
              Reproducible by SHA — pulling at a specific version pins the exact file contents.
            </p>
          </div>
        </aside>

        <section className="source" aria-label="Workflow source">
          <div className="source__head">
            <span className="cluster-sm">
              <Hash size={12} strokeWidth={2} aria-hidden="true" />
              <span>{wf.slug}.{wf.sourceFormat}</span>
            </span>
            <span>{wf.sourceFormat.toUpperCase()}</span>
          </div>
          <div className="source__body">{wf.rawSource}</div>
        </section>
      </div>
    </div>
  );
}

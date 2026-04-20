import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getWorkflow } from "../lib/remoteApi";

export function WorkflowDetailPage() {
  const { owner = "", slug = "" } = useParams();
  const workflow = useQuery({
    queryKey: ["workflow", owner, slug],
    queryFn: () => getWorkflow(owner, slug),
    enabled: Boolean(owner && slug),
  });

  if (workflow.isLoading) {
    return <section className="panel">Loading workflow...</section>;
  }

  if (workflow.isError || !workflow.data) {
    return <section className="panel error">{workflow.error instanceof Error ? workflow.error.message : "Workflow not found"}</section>;
  }

  return (
    <section className="stack">
      <div className="panel">
        <p className="eyebrow">{workflow.data.owner}</p>
        <h2>{workflow.data.title}</h2>
        <p>{workflow.data.description ?? "No description available."}</p>
        <div className="meta-row">
          <span className="pill">{workflow.data.version}</span>
          <span className="pill muted">{workflow.data.sourceFormat}</span>
          <code>{`workflow-manager pull ${workflow.data.owner}/${workflow.data.slug}`}</code>
        </div>
      </div>

      <div className="panel">
        <h3>Raw source preview</h3>
        <pre className="code-block">{workflow.data.rawSource}</pre>
      </div>
    </section>
  );
}

import { ArrowRight, Package, Search, SquareArrowOutUpRight, Upload } from "lucide-react";
import { LinkButton } from "../ui/Button";
import { CodeBlock } from "../ui/CodeBlock";
import { Eyebrow, Panel } from "../ui/Panel";

export function HomePage() {
  return (
    <div className="stack-xl">
      <section className="hero">
        <Eyebrow>Workflow distribution</Eyebrow>
        <h1 className="hero__title">
          Share the workflows that already work locally.
        </h1>
        <p className="hero__lede">
          A remote registry for <code className="code--inline">workflow-manager</code>. Publish
          Markdown or JSON workflows, pull them into any repo, and watch downloads from the dashboard — all
          without changing the local execution engine.
        </p>
        <div className="hero__cta">
          <LinkButton to="/search" variant="primary" trailing={<ArrowRight size={14} strokeWidth={2} />}>
            Browse the registry
          </LinkButton>
          <LinkButton to="/dashboard/publish" variant="ghost">
            Publish a workflow
          </LinkButton>
          <a
            className="btn btn--subtle"
            href="https://github.com/navio/workflow-manager"
            target="_blank"
            rel="noreferrer"
            aria-label="View on GitHub"
          >
            <SquareArrowOutUpRight size={14} strokeWidth={2} aria-hidden="true" />
            GitHub
          </a>
        </div>
      </section>

      <section>
        <CodeBlock prompt label="sh">{`workflow-manager publish ./release-flow.md --visibility public
▸ validated release-flow.md (3 steps)
▸ published alice/release-flow@1.2.0
▸ https://registry.workflow-manager.dev/alice/release-flow`}</CodeBlock>
      </section>

      <section className="stack-lg">
        <Eyebrow>What you get</Eyebrow>
        <div className="grid-3">
          <Panel>
            <div className="stack-sm">
              <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>CLI-first publishing</h3>
              <p className="muted">
                Validate and ship a workflow without leaving the terminal. Markdown frontmatter or JSON, same
                contract.
              </p>
            </div>
            <CodeBlock prompt>{`workflow-manager publish ./my-workflow.json \\
  --visibility public`}</CodeBlock>
          </Panel>

          <Panel>
            <div className="stack-sm">
              <Search size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>Search and pull</h3>
              <p className="muted">
                Discover by owner, slug, or tag. Pull any published version back into local files — reproducible
                by SHA.
              </p>
            </div>
            <CodeBlock prompt>{`workflow-manager pull alice/release-flow \\
  --output ./release-flow.json`}</CodeBlock>
          </Panel>

          <Panel>
            <div className="stack-sm">
              <Package size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>Creator analytics</h3>
              <p className="muted">
                Track downloads, version history, and token usage from the dashboard — no privileged
                credentials required.
              </p>
            </div>
            <CodeBlock prompt>{`workflow-manager auth login \\
  --token wm_...`}</CodeBlock>
          </Panel>
        </div>
      </section>
    </div>
  );
}

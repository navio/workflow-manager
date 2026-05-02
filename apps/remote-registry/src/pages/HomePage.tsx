import { ArrowRight, BookOpenText, Download, Package, Search, SquareArrowOutUpRight, Upload } from "lucide-react";
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
          A remote registry for the <code className="code--inline">wfm</code> CLI. Publish Markdown or JSON
          workflows, pull them into any repo, and watch downloads from the dashboard — all without changing the
          local execution engine.
        </p>
        <div className="hero__cta">
          <LinkButton to="/search" variant="primary" trailing={<ArrowRight size={14} strokeWidth={2} />}>
            Browse the registry
          </LinkButton>
          <LinkButton to="/dashboard/publish" variant="ghost">
            Publish a workflow
          </LinkButton>
          <a
            className="btn btn--ghost"
            href="https://navio.github.io/workflow-manager/"
            target="_blank"
            rel="noreferrer"
            aria-label="Open documentation"
          >
            <BookOpenText size={14} strokeWidth={2} aria-hidden="true" />
            Documentation
          </a>
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
        <CodeBlock prompt label="sh">{`wfm publish ./release-flow.md --visibility public
▸ validated release-flow.md (3 steps)
▸ published alice/release-flow@1.2.0
▸ https://registry.workflow-manager.dev/alice/release-flow`}</CodeBlock>
      </section>

      <section className="stack-lg">
        <Eyebrow>Install locally</Eyebrow>
        <Panel>
          <div className="stack-lg">
            <div className="stack-sm">
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
              <h2>Install the CLI, then pull workflows into any repo.</h2>
              <p className="muted">
                Install `wfm` from npm or the latest GitHub release, then start pulling published workflows
                without cloning the full repo first.
              </p>
            </div>

            <div className="grid-3">
              <div className="stack-sm">
                <span className="kpi__label">npm</span>
                <CodeBlock prompt>{`npm install -g @workflow-manager/runner
wfm --help`}</CodeBlock>
                <p className="muted">Use npm when you want the CLI available through your existing Node toolchain.</p>
              </div>

              <div className="stack-sm">
                <span className="kpi__label">Latest release</span>
                <CodeBlock prompt>{`curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
wfm --help`}</CodeBlock>
              </div>

              <div className="stack-sm">
                <span className="kpi__label">Custom install dir</span>
                <CodeBlock prompt>{`curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | \\
  WORKFLOW_MANAGER_INSTALL_DIR="$HOME/bin" bash`}</CodeBlock>
                <p className="muted">
                  Prebuilt binaries are available for macOS arm64 and Linux x64. Windows release assets are also
                  published for manual download.
                </p>
              </div>
            </div>
          </div>
        </Panel>
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
            <CodeBlock prompt>{`wfm publish ./my-workflow.json \\
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
            <CodeBlock prompt>{`wfm pull alice/release-flow \\
  --output ./release-flow.json`}</CodeBlock>
          </Panel>

          <Panel>
            <div className="stack-sm">
              <Package size={18} strokeWidth={1.75} aria-hidden="true" />
              <h3>Creator analytics</h3>
              <p className="muted">
                Track downloads, version history, and token usage from the dashboard — no privileged credentials
                required.
              </p>
            </div>
            <CodeBlock prompt>{`wfm auth login \\
  --token wm_...`}</CodeBlock>
          </Panel>
        </div>
      </section>
    </div>
  );
}

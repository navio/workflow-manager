import {
  ArrowRight,
  Blocks,
  BookOpenText,
  Bot,
  Check,
  CodeXml,
  Download,
  GitBranch,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareArrowOutUpRight,
  Terminal,
  Upload,
} from "lucide-react";
import { LinkButton } from "../ui/Button";
import { CodeBlock, InlineCode } from "../ui/CodeBlock";
import { Eyebrow, Panel } from "../ui/Panel";
import { Pill } from "../ui/Pill";

export function HomePage() {
  return (
    <div className="stack-xl">
      <section className="hero-layout">
        <div className="hero">
          <Eyebrow>Agent workflow orchestration</Eyebrow>
          <h1 className="hero__title">
            Define the workflow once. Run it on any coding agent.
          </h1>
          <p className="hero__lede">
            <InlineCode>wfm</InlineCode> coordinates dependencies, approvals, retries, and rollback, then runs
            each step through pi-agent, OpenCode, Codex, Claude Code, or any ACP-compatible agent.
          </p>
          <div className="hero__cta">
            <LinkButton to="/search" variant="primary" trailing={<ArrowRight size={14} strokeWidth={1.75} />}>
              Browse the registry
            </LinkButton>
            <a
              className="btn btn--ghost"
              href="https://navio.github.io/workflow-manager/"
              target="_blank"
              rel="noreferrer"
              aria-label="Open documentation"
            >
              <BookOpenText size={14} strokeWidth={1.75} aria-hidden="true" />
              Documentation
            </a>
            <a
              className="btn btn--subtle"
              href="https://github.com/navio/workflow-manager"
              target="_blank"
              rel="noreferrer"
              aria-label="View workflow-manager on GitHub"
            >
              <SquareArrowOutUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
              GitHub
            </a>
          </div>
        </div>

        <aside className="workflow-preview" aria-label="Example orchestrated workflow">
          <div className="workflow-preview__header">
            <div className="stack-sm">
              <Eyebrow>Execution plan</Eyebrow>
              <h2>release-flow</h2>
            </div>
            <Pill tone="ok">ready</Pill>
          </div>

          <div className="workflow-preview__steps">
            <div className="workflow-step">
              <span className="workflow-step__icon"><GitBranch size={16} strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="workflow-step__body">
                <strong>Resolve dependency graph</strong>
                <small>3 steps · deterministic order</small>
              </span>
              <Check size={16} strokeWidth={1.75} className="workflow-step__status" aria-hidden="true" />
            </div>
            <div className="workflow-step">
              <span className="workflow-step__icon"><ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="workflow-step__body">
                <strong>Run approval gate</strong>
                <small>release-owner review</small>
              </span>
              <span className="workflow-step__pulse" aria-hidden="true" />
            </div>
            <div className="workflow-step">
              <span className="workflow-step__icon"><RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" /></span>
              <span className="workflow-step__body">
                <strong>Publish and verify</strong>
                <small>retry twice · rollback enabled</small>
              </span>
              <span className="workflow-step__pending" aria-hidden="true">03</span>
            </div>
          </div>

          <div className="workflow-preview__agents">
            <span>Agent adapters</span>
            <div className="cluster-sm">
              <Pill tone="outline">Codex</Pill>
              <Pill tone="outline">OpenCode</Pill>
              <Pill tone="outline">ACP</Pill>
            </div>
          </div>
        </aside>
      </section>

      <section className="hero-command" aria-label="Publish a workflow from the command line">
        <CodeBlock prompt label="sh">{`wfm publish ./release-flow.md --visibility public
▸ validated release-flow.md (3 steps)
▸ published alice/release-flow@1.2.0
▸ https://registry.workflow-manager.dev/alice/release-flow`}</CodeBlock>
      </section>

      <section className="stack-lg">
        <div className="section-heading">
          <div className="stack-sm">
            <Eyebrow>Agent adapters</Eyebrow>
            <h2>Bring the agent your team already uses.</h2>
          </div>
          <p className="muted">
            Workflow behavior stays consistent while the execution backend changes.
          </p>
        </div>
        <div className="grid-2">
          <Panel tight className="agent-card">
            <span className="agent-card__icon"><Terminal size={18} strokeWidth={1.75} aria-hidden="true" /></span>
            <div className="stack-sm">
              <h3>pi-agent</h3>
              <p className="muted">The default local coding-agent runtime.</p>
            </div>
          </Panel>

          <Panel tight className="agent-card">
            <span className="agent-card__icon"><Blocks size={18} strokeWidth={1.75} aria-hidden="true" /></span>
            <div className="stack-sm">
              <h3>OpenCode</h3>
              <p className="muted">First-class execution through ACP.</p>
            </div>
          </Panel>

          <Panel tight className="agent-card">
            <span className="agent-card__icon"><Bot size={18} strokeWidth={1.75} aria-hidden="true" /></span>
            <div className="stack-sm">
              <h3>Codex</h3>
              <p className="muted">Run Codex with the same workflow contract.</p>
            </div>
          </Panel>

          <Panel tight className="agent-card">
            <span className="agent-card__icon"><CodeXml size={18} strokeWidth={1.75} aria-hidden="true" /></span>
            <div className="stack-sm">
              <h3>Claude Code</h3>
              <p className="muted">Use Claude Code as a native adapter.</p>
            </div>
          </Panel>
        </div>
        <p className="muted">
          Building against a different agent? The generic ACP adapter runs any Agent Client
          Protocol–compatible CLI.
        </p>
      </section>

      <section className="stack-lg">
        <Eyebrow>Install locally</Eyebrow>
        <Panel>
          <div className="stack-lg">
            <div className="stack-sm">
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
              <h2>Install the CLI, then pull workflows into any repo.</h2>
              <p className="muted">
                Install <InlineCode>wfm</InlineCode> from npm or the latest GitHub release, then pull published workflows
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

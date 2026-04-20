export function HomePage() {
  return (
    <section className="stack page-grid">
      <div className="hero-card">
        <p className="eyebrow">Workflow distribution</p>
        <h2>Share the workflows that already work locally.</h2>
        <p>
          The remote registry turns `workflow-manager` into a shared workflow catalog with publishing, pull commands, creator analytics,
          and CLI tokens for authenticated automation.
        </p>
      </div>

      <div className="feature-grid">
        <article className="panel">
          <h3>CLI-first publishing</h3>
          <p>Publish a validated Markdown or JSON workflow without changing the local execution engine.</p>
          <code>workflow-manager publish ./my-workflow.json --visibility public</code>
        </article>
        <article className="panel">
          <h3>Search and pull</h3>
          <p>Discover workflows by owner, slug, and metadata, then pull them back down into local files.</p>
          <code>workflow-manager pull alice/release-flow --output ./release-flow.json</code>
        </article>
        <article className="panel">
          <h3>Creator analytics</h3>
          <p>Track downloads, version history, and token usage from the dashboard without exposing privileged credentials.</p>
          <code>workflow-manager auth login --token wm_...</code>
        </article>
      </div>
    </section>
  );
}

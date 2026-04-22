import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Search as SearchIcon, Terminal } from "lucide-react";
import { searchWorkflows } from "../lib/remoteApi";
import { CodeBlock, InlineCode } from "../ui/CodeBlock";
import { Eyebrow } from "../ui/Panel";
import { Pill } from "../ui/Pill";
import { StatusBanner } from "../ui/StatusBanner";

export function SearchPage() {
  const [query, setQuery] = useState("bunny");
  const search = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchWorkflows(query),
  });

  return (
    <div className="stack">
      <div className="stack-sm">
        <Eyebrow>Registry / search</Eyebrow>
        <h1>Find a workflow</h1>
      </div>

      <label className="search-bar">
        <SearchIcon size={16} strokeWidth={2} aria-hidden="true" className="muted" />
        <input
          name="workflow-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by owner, title, slug, or tag…"
          aria-label="Search workflows"
        />
        <span className="cluster-sm muted" style={{ fontSize: 12 }}>
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </label>

      {search.isLoading && (
        <div className="empty">
          <Terminal size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
          <div className="muted">Searching the registry…</div>
        </div>
      )}

      {search.isError && (
        <StatusBanner tone="err">{(search.error as Error).message}</StatusBanner>
      )}

      {search.data && search.data.items.length === 0 && (
        <div className="empty">
          <SearchIcon size={20} strokeWidth={1.75} className="empty__icon" aria-hidden="true" />
          <div className="empty__title">No workflows match “{query}”</div>
          <div className="muted">Try a different keyword, or publish the first one.</div>
          <CodeBlock prompt>workflow-manager publish ./my-workflow.md --visibility public</CodeBlock>
        </div>
      )}

      {search.data && search.data.items.length > 0 && (
        <div className="panel panel--flush">
          <div className="stack" style={{ padding: "0 24px" }}>
            {search.data.items.map((item) => (
              <article key={`${item.owner}/${item.slug}`} className="wf-row">
                <div className="wf-row__meta">
                  <div className="cluster-sm">
                    <span className="wf-row__path tabular">{item.owner}/</span>
                    <h2 className="wf-row__title">{item.title}</h2>
                  </div>
                  <p className="wf-row__desc">{item.description ?? "No description yet."}</p>
                  <div className="cluster-sm">
                    <InlineCode>workflow-manager pull {item.owner}/{item.slug}</InlineCode>
                  </div>
                </div>
                <div className="wf-row__side">
                  <Pill tone={item.visibility === "public" ? "ok" : "outline"}>{item.visibility}</Pill>
                  <Link
                    to={`/workflow/${item.owner}/${item.slug}`}
                    className="btn btn--subtle btn--sm"
                    style={{ marginTop: 4 }}
                  >
                    Details
                    <ArrowRight size={12} strokeWidth={2} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

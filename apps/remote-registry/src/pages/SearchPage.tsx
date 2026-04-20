import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { searchWorkflows } from "../lib/remoteApi";

export function SearchPage() {
  const [query, setQuery] = useState("bunny");
  const search = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchWorkflows(query),
  });

  return (
    <section className="stack">
      <div className="panel search-panel">
        <label className="stack compact">
          <span className="eyebrow">Search workflows</span>
          <input
            name="workflow-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by owner, title, or slug"
          />
        </label>
      </div>

      <div className="stack compact">
        {search.isLoading && <div className="panel">Loading workflows...</div>}
        {search.isError && <div className="panel error">{(search.error as Error).message}</div>}
        {search.data && search.data.items.length === 0 && <div className="panel">No workflows found yet.</div>}
        {search.data?.items.map((item) => (
          <article key={`${item.owner}/${item.slug}`} className="panel workflow-card">
            <div className="workflow-card__header">
              <div>
                <p className="eyebrow">{item.ownerDisplayName ?? item.owner}</p>
                <h3>{item.title}</h3>
              </div>
              <span className="pill">{item.visibility}</span>
            </div>
            <p>{item.description ?? "No description yet."}</p>
            <div className="meta-row">
              <code>{`workflow-manager pull ${item.owner}/${item.slug}`}</code>
              <Link to={`/workflow/${item.owner}/${item.slug}`}>Details</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

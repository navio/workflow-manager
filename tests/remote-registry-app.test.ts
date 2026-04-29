import { afterEach, describe, expect, it } from "bun:test";
import { getWorkflow } from "../apps/remote-registry/src/lib/remoteApi";
import { detectSourceFormat, parseWorkflowSource } from "../apps/remote-registry/src/lib/workflowSource";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("remote registry app workflow parsing", () => {
  it("parses JSON workflow source for dashboard publishing", () => {
    const parsed = parseWorkflowSource(
      JSON.stringify({
        key: "dashboard-demo",
        title: "Dashboard Demo",
        steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } }],
      })
    );

    expect(parsed.sourceFormat).toBe("json");
    expect(parsed.definition.key).toBe("dashboard-demo");
    expect(parsed.definition.steps).toHaveLength(1);
  });

  it("parses Markdown frontmatter workflow source for dashboard publishing", () => {
    const parsed = parseWorkflowSource(`---
key: dashboard-md
title: Dashboard Markdown
steps:
  - key: plan
    kind: task
    taskSpec:
      adapterKey: mock
---

# Notes
`);

    expect(parsed.sourceFormat).toBe("markdown");
    expect(parsed.definition.title).toBe("Dashboard Markdown");
  });

  it("detects source format heuristically", () => {
    expect(detectSourceFormat('{"key":"demo"}')).toBe("json");
    expect(detectSourceFormat("---\nkey: demo\n")).toBe("markdown");
  });

  it("throws for invalid workflow source", () => {
    expect(() => parseWorkflowSource("not-a-workflow")).toThrow();
  });

  it("includes the session token when loading a workflow detail", async () => {
    let authorization = "";
    globalThis.fetch = (async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({ owner: "alice", slug: "demo", title: "Demo", description: null, visibility: "public", version: "v1", sourceFormat: "json", rawSource: "{}", changelog: null, publishedState: "published", createdAt: new Date().toISOString() });
    }) as typeof fetch;

    await getWorkflow("alice", "demo", "access-token");
    expect(authorization).toBe("Bearer access-token");
  });
});

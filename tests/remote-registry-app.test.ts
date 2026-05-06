import { afterEach, describe, expect, it } from "bun:test";
import { getWorkflow } from "../apps/remote-registry/src/lib/remoteApi";
import { publishWorkflow } from "../apps/remote-registry/src/lib/remoteApi";
import { detectSourceFormat, parseWorkflowSource } from "../apps/remote-registry/src/lib/workflowSource";
import { publishedWorkflowDetailPath } from "../apps/remote-registry/src/pages/PublishWorkflowPage";

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

  it("includes the session token and public publish payload when creating a workflow", async () => {
    let authorization = "";
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Response.json({ ownerUserId: "user-1", slug: "demo", version: "v1", visibility: "public", publishedState: "published", title: "Demo", sourceFormat: "json", createdAt: new Date().toISOString(), tags: [] });
    }) as typeof fetch;

    await publishWorkflow("access-token", {
      slug: "demo",
      title: "Demo",
      description: "Created from UI",
      visibility: "public",
      versionLabel: "v1",
      sourceFormat: "json",
      rawSource: '{"key":"demo","title":"Demo","steps":[{"key":"plan","kind":"task","taskSpec":{"adapterKey":"mock"}}]}',
      definition: {
        key: "demo",
        title: "Demo",
        steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } }],
      },
      tags: ["ui"],
      changelog: "Initial UI publish",
      publishedState: "published",
    });

    expect(authorization).toBe("Bearer access-token");
    expect(body?.visibility).toBe("public");
    expect(body?.publishedState).toBe("published");
    expect(body?.slug).toBe("demo");
  });

  it("builds a workflow detail path from the owner user id after publishing", () => {
    expect(publishedWorkflowDetailPath("user-1", "demo-flow")).toBe("/workflow/user-1/demo-flow");
  });
});

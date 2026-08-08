import { afterEach, describe, expect, it } from "bun:test";
import { getWorkflow } from "../apps/remote-registry/src/lib/remoteApi";
import { publishWorkflow } from "../apps/remote-registry/src/lib/remoteApi";
import { fetchWorkflowObservability } from "../apps/remote-registry/src/lib/remoteApi";
import { latestAnalyticsVersion, latestManagedVersion, publishedWorkflowDetailPath } from "../apps/remote-registry/src/lib/workflowPublishing";
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

  it("preserves HTTP context for non-JSON remote errors", async () => {
    globalThis.fetch = (async () => new Response("Bad gateway", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;

    await expect(getWorkflow("alice", "demo")).rejects.toThrow("HTTP 502 Bad Gateway: Bad gateway");
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

  it("requests workflow observability with the session token, slug, version, and window", async () => {
    let authorization = "";
    let requestedUrl = "";
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        workflow: { slug: "demo", versionLabel: "v1" },
        owner: {
          totalRuns: 1,
          succeededRuns: 1,
          failedRuns: 0,
          waitingRuns: 0,
          cancelledRuns: 0,
          retriedRuns: 0,
          successRate: 100,
          averageDurationMs: 1000,
          p50DurationMs: 1000,
          p95DurationMs: 1000,
        },
        community: {
          totalRuns: 0,
          succeededRuns: 0,
          failedRuns: 0,
          waitingRuns: 0,
          cancelledRuns: 0,
          retriedRuns: 0,
          successRate: 0,
          averageDurationMs: null,
          p50DurationMs: null,
          p95DurationMs: null,
          distinctUsers: null,
          suppressed: true,
          minimumCohort: 5,
        },
        byRuntime: [],
        steps: [],
      });
    }) as typeof fetch;

    const result = await fetchWorkflowObservability("access-token", "demo", { version: "v1", window: "7d" });

    expect(authorization).toBe("Bearer access-token");
    expect(requestedUrl).toContain("workflow-observability?");
    expect(requestedUrl).toContain("slug=demo");
    expect(requestedUrl).toContain("version=v1");
    expect(requestedUrl).toContain("window=7d");
    expect(result.community.suppressed).toBe(true);
  });

  it("builds a workflow detail path from the owner handle after publishing", () => {
    expect(publishedWorkflowDetailPath("alice", "demo-flow")).toBe("/workflow/alice/demo-flow");
  });

  it("prefers the newest analytics version for draft visibility messaging", () => {
    expect(
      latestAnalyticsVersion({
        slug: "demo",
        title: "Demo",
        visibility: "public",
        updatedAt: new Date().toISOString(),
        totalDownloads: 0,
        lastDownloadedAt: null,
        dailyStats: [],
        downloadsByVersion: [
          { version: "v2", publishedState: "draft", createdAt: new Date().toISOString(), downloads: 0 },
          { version: "v1", publishedState: "published", createdAt: new Date().toISOString(), downloads: 12 },
        ],
      })?.publishedState
    ).toBe("draft");
  });

  it("resolves the latest managed version for draft warnings", () => {
    expect(
      latestManagedVersion({
        slug: "demo",
        title: "Demo",
        description: null,
        visibility: "public",
        latestVersionId: "version-2",
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        latestTags: [],
        versions: [
          {
            id: "version-1",
            version: "v1",
            sourceFormat: "json",
            rawSource: "{}",
            changelog: null,
            publishedState: "published",
            createdAt: new Date().toISOString(),
            isLatest: false,
          },
          {
            id: "version-2",
            version: "v2",
            sourceFormat: "json",
            rawSource: "{}",
            changelog: null,
            publishedState: "draft",
            createdAt: new Date().toISOString(),
            isLatest: true,
          },
        ],
      })?.version
    ).toBe("v2");
  });
});

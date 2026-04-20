import { describe, expect, it } from "bun:test";
import { detectSourceFormat, parseWorkflowSource } from "../apps/remote-registry/src/lib/workflowSource";

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
});

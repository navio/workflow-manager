import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorkflowMarkdown, validateWorkflow } from "../src/parser.js";

describe("parser", () => {
  it("parses frontmatter workflow with objectives and init config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const file = path.join(dir, "wf.md");
    fs.writeFileSync(
      file,
      `---
key: demo
title: Demo
objectives: [a, b]
steps:
  - key: s1
    kind: task
    taskSpec:
      adapterKey: opencode
      init:
        skills: [analysis]
        mcps: [mcp://repo]
---\n`,
      "utf-8"
    );

    const wf = parseWorkflowMarkdown(file);
    expect(wf.objectives).toEqual(["a", "b"]);
    expect(wf.steps[0].taskSpec?.adapterKey).toBe("opencode");
    expect(wf.steps[0].taskSpec?.init?.skills).toContain("analysis");
    expect(validateWorkflow(wf)).toEqual([]);
  });

  it("validates bad dependencies and unsupported adapters", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const file = path.join(dir, "wf2.md");
    fs.writeFileSync(
      file,
      `---
key: demo
title: Demo
steps:
  - key: s1
    kind: task
    dependsOn: [missing]
    taskSpec:
      adapterKey: unknown
---\n`,
      "utf-8"
    );

    const wf = parseWorkflowMarkdown(file);
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("depends on unknown step"))).toBe(true);
    expect(errors.some((e) => e.includes("Unsupported adapter"))).toBe(true);
  });
});

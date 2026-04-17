import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorkflowFile, parseWorkflowJson, parseWorkflowMarkdown, validateWorkflow } from "../src/parser.ts";

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

  it("parses workflow JSON with normalized defaults", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const file = path.join(dir, "wf.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        key: "demo-json",
        title: "Demo JSON",
        steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "codex" } }],
      }),
      "utf-8"
    );

    const wf = parseWorkflowJson(file);
    expect(wf.steps[0].dependsOn).toEqual([]);
    expect(wf.steps[0].validation?.mode).toBe("none");
    expect(validateWorkflow(wf)).toEqual([]);
  });

  it("auto-detects parser from file extension", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const jsonFile = path.join(dir, "wf.json");
    const mdFile = path.join(dir, "wf.md");

    fs.writeFileSync(jsonFile, JSON.stringify({ key: "auto-json", title: "Auto JSON", steps: [] }), "utf-8");
    fs.writeFileSync(mdFile, `---\nkey: auto-md\ntitle: Auto MD\nsteps: []\n---\n`, "utf-8");

    expect(parseWorkflowFile(jsonFile).key).toBe("auto-json");
    expect(parseWorkflowFile(mdFile).key).toBe("auto-md");
  });
});

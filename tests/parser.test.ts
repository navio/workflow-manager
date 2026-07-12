import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
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

  it("validates circular dependencies", () => {
    const errors = validateWorkflow({
      key: "cycle-wf",
      title: "Cycle WF",
      steps: [
        { key: "first", kind: "task", dependsOn: ["second"], taskSpec: { adapterKey: "mock" } },
        { key: "second", kind: "task", dependsOn: ["first"], taskSpec: { adapterKey: "mock" } },
      ],
    });

    expect(errors.some((error) => error.includes("Circular dependency detected"))).toBe(true);
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

  it("defaults omitted task adapters to pi-agent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const file = path.join(dir, "wf-default-adapter.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        key: "default-adapter",
        title: "Default Adapter",
        steps: [{ key: "s1", kind: "task", taskSpec: {} }],
      }),
      "utf-8"
    );

    const wf = parseWorkflowFile(file);
    expect(wf.steps[0].taskSpec?.adapterKey).toBe("pi-agent");
  });

  it("validates pi-agent as a supported adapter", () => {
    const errors = validateWorkflow({
      key: "pi-agent-wf",
      title: "PI Agent WF",
      steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "pi-agent" } }],
    });

    expect(errors).toEqual([]);
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

  it("rejects steps missing required key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const file = path.join(dir, "invalid-step-key.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        key: "invalid-missing-step-key",
        title: "Invalid Workflow",
        steps: [
          {
            kind: "task",
            dependsOn: [],
            taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
          },
        ],
      }),
      "utf-8"
    );

    const wf = parseWorkflowJson(file);
    const errors = validateWorkflow(wf);
    expect(errors).toContain("Each step must define a non-empty key");
  });

  it("rejects task steps without taskSpec", () => {
    const wf = {
      key: "invalid-task-spec",
      title: "Invalid task spec",
      steps: [
        {
          key: "s1",
          kind: "task",
        },
      ],
    } as unknown as ReturnType<typeof parseWorkflowJson>;

    const errors = validateWorkflow(wf);
    expect(errors).toContain("Task step s1 is missing taskSpec");
  });
});

describe("parser — agent validation", () => {
  it("accepts validation.mode 'agent' on task steps", () => {
    const wf = {
      key: "agent-validation-ok",
      title: "Agent validation ok",
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "agent", agent: { criteria: "must include tests" } },
          taskSpec: { adapterKey: "mock" },
        },
      ],
    } as unknown as ReturnType<typeof parseWorkflowJson>;

    expect(validateWorkflow(wf)).toEqual([]);
  });

  it("accepts validation.mode 'agent' with no agent spec (all defaults)", () => {
    const wf = {
      key: "agent-validation-defaults",
      title: "Agent validation defaults",
      steps: [{ key: "s1", kind: "task", validation: { mode: "agent" }, taskSpec: { adapterKey: "mock" } }],
    } as unknown as ReturnType<typeof parseWorkflowJson>;

    expect(validateWorkflow(wf)).toEqual([]);
  });

  it("rejects agent validation on approval steps", () => {
    const wf = {
      key: "agent-validation-approval-rejected",
      title: "Agent validation approval rejected",
      steps: [
        {
          key: "gate",
          kind: "approval",
          approvalSpec: { validation: { mode: "agent" } },
        },
      ],
    } as unknown as ReturnType<typeof parseWorkflowJson>;

    const errors = validateWorkflow(wf);
    expect(errors).toContain("Approval step gate cannot use agent validation");
  });

  it("rejects an unsupported validator adapter", () => {
    const wf = {
      key: "agent-validation-bad-adapter",
      title: "Agent validation bad adapter",
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "agent", agent: { adapterKey: "not-a-real-adapter" } },
          taskSpec: { adapterKey: "mock" },
        },
      ],
    } as unknown as ReturnType<typeof parseWorkflowJson>;

    const errors = validateWorkflow(wf);
    expect(errors).toContain("Unsupported validator adapter for s1: not-a-real-adapter");
  });

  it("still validates legacy workflows that omit the validation field entirely", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"));
    const file = path.join(dir, "legacy.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        key: "legacy-no-validation",
        title: "Legacy no validation",
        steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "mock" } }],
      }),
      "utf-8"
    );

    const wf = parseWorkflowJson(file);
    expect(wf.steps[0].validation?.mode).toBe("none");
    expect(validateWorkflow(wf)).toEqual([]);
  });
});

describe("parser — skills field", () => {
  it("preserves the skills map through normalization", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-parser-"));
    try {
      const file = path.join(tmpDir, "wf.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          key: "k",
          title: "t",
          skills: {
            "my-skill": { content: "# Embedded" },
            "ref-skill": { source: "./skills/ref/SKILL.md" },
          },
          steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "mock" } }],
        })
      );
      const parsed = parseWorkflowFile(file);
      expect(parsed.skills?.["my-skill"]?.content).toBe("# Embedded");
      expect(parsed.skills?.["ref-skill"]?.source).toBe("./skills/ref/SKILL.md");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("parser — skills validation", () => {
  function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  it("rejects skill source paths outside ./skills/**/SKILL.md", () => {
    const wf = {
      key: "k",
      title: "t",
      skills: {
        demo: { source: "./README.md" },
      },
      steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "mock" } }],
    } as ReturnType<typeof parseWorkflowJson>;
    const errors = validateWorkflow(wf);
    expect(errors).toContain('Skill "demo" source must be under ./skills/**/SKILL.md');
  });

  it("rejects mismatched contentSha256", () => {
    const wf = {
      key: "k",
      title: "t",
      skills: {
        demo: {
          content: "# Skill",
          contentSha256: sha256("# different"),
        },
      },
      steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "mock" } }],
    } as ReturnType<typeof parseWorkflowJson>;
    const errors = validateWorkflow(wf);
    expect(errors).toContain('Skill "demo" contentSha256 does not match content');
  });

  it("accepts matching hash and upstream metadata", () => {
    const content = "# Skill";
    const wf = {
      key: "k",
      title: "t",
      skills: {
        demo: {
          source: "./skills/demo/SKILL.md",
          content,
          contentSha256: sha256(content),
          upstream: {
            repo: "github.com/acme/skills",
            ref: "abc123",
            path: "demo/SKILL.md",
          },
        },
      },
      steps: [{ key: "s1", kind: "task", taskSpec: { adapterKey: "mock" } }],
    } as ReturnType<typeof parseWorkflowJson>;
    expect(validateWorkflow(wf)).toEqual([]);
  });
});

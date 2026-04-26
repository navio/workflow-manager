import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSkill } from "../src/skillResolver.ts";
import type { WorkflowDefinition } from "../src/types.ts";

function baseWorkflow(skills: WorkflowDefinition["skills"] = {}): WorkflowDefinition {
  return { key: "wf", title: "wf", steps: [], skills };
}

function withTempWorkflow(skillContent: string, fn: (workflowFile: string, skillFile: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-skill-"));
  const skillFile = path.join(dir, "MY_SKILL.md");
  const workflowFile = path.join(dir, "wf.json");
  fs.writeFileSync(skillFile, skillContent);
  fs.writeFileSync(workflowFile, "{}");
  try {
    fn(workflowFile, skillFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("resolveSkill — embedded content", () => {
  it("returns embedded content when present", () => {
    const wf = baseWorkflow({
      "spec-driven-development": { content: "# Embedded skill\n\nDo specs first." },
    });
    const result = resolveSkill("spec-driven-development", wf, "/tmp/wf.json");
    expect(result?.content).toBe("# Embedded skill\n\nDo specs first.");
    expect(result?.origin).toBe("embedded");
  });

  it("returns null when skill name not in workflow and no other source available", () => {
    const wf = baseWorkflow({});
    const result = resolveSkill("missing-skill", wf, "/tmp/nonexistent-dir/wf.json");
    expect(result).toBeNull();
  });
});

describe("resolveSkill — workflow source path", () => {
  it("reads content from skills[name].source path relative to workflow file", () => {
    withTempWorkflow("# From source\n\nLoaded from path.", (workflowFile, _skillFile) => {
      const wf = baseWorkflow({
        "my-skill": { source: "./MY_SKILL.md" },
      });
      const result = resolveSkill("my-skill", wf, workflowFile);
      expect(result?.content).toBe("# From source\n\nLoaded from path.");
      expect(result?.origin).toBe("source");
    });
  });

  it("prefers embedded content over source path when both present", () => {
    withTempWorkflow("# from disk", (workflowFile, _skillFile) => {
      const wf = baseWorkflow({
        "my-skill": { source: "./MY_SKILL.md", content: "# embedded wins" },
      });
      const result = resolveSkill("my-skill", wf, workflowFile);
      expect(result?.content).toBe("# embedded wins");
      expect(result?.origin).toBe("embedded");
    });
  });

  it("returns null when source path does not exist", () => {
    const wf = baseWorkflow({
      "my-skill": { source: "./does-not-exist.md" },
    });
    const result = resolveSkill("my-skill", wf, "/tmp/nonexistent-dir/wf.json");
    expect(result).toBeNull();
  });
});

describe("resolveSkill — project local tier", () => {
  it("reads from <workflowDir>/skills/<name>/SKILL.md", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-skill-"));
    try {
      const skillDir = path.join(dir, "skills", "local-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Project local skill");
      const workflowFile = path.join(dir, "wf.json");
      fs.writeFileSync(workflowFile, "{}");

      const result = resolveSkill("local-skill", baseWorkflow(), workflowFile);
      expect(result?.content).toBe("# Project local skill");
      expect(result?.origin).toBe("project-local");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveSkill — name safety", () => {
  it("rejects names with path traversal segments", () => {
    const result = resolveSkill("../../etc/passwd", baseWorkflow(), "/tmp/wf.json");
    expect(result).toBeNull();
  });

  it("rejects names with absolute path indicators", () => {
    const result = resolveSkill("/etc/passwd", baseWorkflow(), "/tmp/wf.json");
    expect(result).toBeNull();
  });
});

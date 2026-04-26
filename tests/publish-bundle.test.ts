import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleSkills } from "../src/remote/commands.ts";
import type { WorkflowDefinition } from "../src/types.ts";

describe("bundleSkills", () => {
  it("inlines content from skills[name].source paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-bundle-"));
    try {
      const skillDir = path.join(dir, "skills", "demo");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Demo\n\nDo the thing.");
      const wf: WorkflowDefinition = {
        key: "k",
        title: "t",
        steps: [],
        skills: { demo: { source: "./skills/demo/SKILL.md" } },
      };
      const workflowFile = path.join(dir, "wf.json");
      fs.writeFileSync(workflowFile, JSON.stringify(wf));

      const bundled = bundleSkills(wf, workflowFile);
      expect(bundled.skills?.demo?.content).toBe("# Demo\n\nDo the thing.");
      expect(bundled.skills?.demo?.source).toBe("./skills/demo/SKILL.md");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves already-embedded content unchanged", () => {
    const wf: WorkflowDefinition = {
      key: "k",
      title: "t",
      steps: [],
      skills: { demo: { content: "# Already embedded" } },
    };
    const bundled = bundleSkills(wf, "/tmp/wf.json");
    expect(bundled.skills?.demo?.content).toBe("# Already embedded");
  });

  it("throws on missing source path", () => {
    const wf: WorkflowDefinition = {
      key: "k",
      title: "t",
      steps: [],
      skills: { demo: { source: "./does-not-exist.md" } },
    };
    expect(() => bundleSkills(wf, "/tmp/nonexistent/wf.json")).toThrow();
  });

  it("returns workflow unchanged when no skills map", () => {
    const wf: WorkflowDefinition = { key: "k", title: "t", steps: [] };
    const bundled = bundleSkills(wf, "/tmp/wf.json");
    expect(bundled.skills).toBeUndefined();
  });
});

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleSkills } from "../src/remote/commands.ts";
import type { WorkflowDefinition } from "../src/types.ts";

describe("bundleSkills", () => {
  function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

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
      expect(bundled.skills?.demo?.contentSha256).toBe(sha256("# Demo\n\nDo the thing."));
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
    expect(bundled.skills?.demo?.contentSha256).toBe(sha256("# Already embedded"));
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

  it("throws on source path outside allowed local skills directory", () => {
    const wf: WorkflowDefinition = {
      key: "k",
      title: "t",
      steps: [],
      skills: { demo: { source: "./README.md" } },
    };
    expect(() => bundleSkills(wf, "/tmp/wf.json")).toThrow();
  });

  it("preserves upstream metadata while adding hash", () => {
    const wf: WorkflowDefinition = {
      key: "k",
      title: "t",
      steps: [],
      skills: {
        demo: {
          content: "# Already embedded",
          upstream: {
            repo: "github.com/acme/skills",
            ref: "abc123",
            path: "demo/SKILL.md",
          },
        },
      },
    };
    const bundled = bundleSkills(wf, "/tmp/wf.json");
    expect(bundled.skills?.demo?.upstream?.repo).toBe("github.com/acme/skills");
    expect(bundled.skills?.demo?.upstream?.ref).toBe("abc123");
    expect(bundled.skills?.demo?.upstream?.path).toBe("demo/SKILL.md");
    expect(bundled.skills?.demo?.contentSha256).toBe(sha256("# Already embedded"));
  });

  it("returns workflow unchanged when no skills map", () => {
    const wf: WorkflowDefinition = { key: "k", title: "t", steps: [] };
    const bundled = bundleSkills(wf, "/tmp/wf.json");
    expect(bundled.skills).toBeUndefined();
  });
});

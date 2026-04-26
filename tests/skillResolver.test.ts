import { describe, expect, it } from "bun:test";
import { resolveSkill } from "../src/skillResolver.ts";
import type { WorkflowDefinition } from "../src/types.ts";

function baseWorkflow(skills: WorkflowDefinition["skills"] = {}): WorkflowDefinition {
  return { key: "wf", title: "wf", steps: [], skills };
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

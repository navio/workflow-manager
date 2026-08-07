import { describe, expect, it } from "bun:test";
import { MODEL_CATALOG, lookupModel, renderCatalogForPrompt } from "../src/modelCatalog.ts";
import type { WorkflowDefinition } from "../src/types.ts";
import { buildWorkflowDigest } from "../src/judge.ts";

describe("modelCatalog", () => {
  it("matches model ids case-insensitively by substring pattern", () => {
    expect(lookupModel("claude-fable-5")?.tier).toBe("frontier");
    expect(lookupModel("Claude-Haiku-4-5")?.tier).toBe("small");
    expect(lookupModel("openrouter/anthropic/claude-sonnet-5")?.tier).toBe("mid");
  });

  it("matches the more specific pattern first (codex before gpt-5, mini before gpt-5)", () => {
    expect(lookupModel("gpt-5.3-codex")?.strengths).toContain("coding");
    expect(lookupModel("gpt-5-mini")?.tier).toBe("small");
    expect(lookupModel("gpt-5")?.tier).toBe("frontier");
  });

  it("classifies gemini ids as google, not the OpenAI mini tier", () => {
    expect(lookupModel("gemini-2.5-pro")?.provider).toBe("google");
    expect(lookupModel("gpt-5-mini")?.provider).toBe("openai");
  });

  it("returns undefined for unknown or empty model ids", () => {
    expect(lookupModel("totally-unknown-model")).toBeUndefined();
    expect(lookupModel("   ")).toBeUndefined();
  });

  it("renders every catalog entry into the prompt table", () => {
    const table = renderCatalogForPrompt();
    for (const entry of MODEL_CATALOG) {
      expect(table).toContain(entry.displayName);
    }
    expect(table).toContain("Cost band");
  });
});

function demoWorkflow(): WorkflowDefinition {
  return {
    key: "demo",
    title: "Demo",
    objectives: ["ship it"],
    steps: [
      {
        key: "fetch",
        kind: "task",
        objective: "Fetch the sources",
        taskSpec: {
          adapterKey: "mock",
          init: {
            model: "claude-fable-5",
            skills: ["research"],
            systemPrompts: ["be thorough", "cite sources"],
            context: { urls: ["https://example.com"] },
            stateFrom: "none",
          },
        },
      },
      {
        key: "review",
        kind: "approval",
        dependsOn: ["fetch"],
      },
    ],
  };
}

describe("buildWorkflowDigest", () => {
  it("summarizes steps without carrying full prompt content", () => {
    const digest = buildWorkflowDigest(demoWorkflow());
    expect(digest.key).toBe("demo");
    expect(digest.stepCount).toBe(2);
    const fetch = digest.steps[0];
    expect(fetch.adapterKey).toBe("mock");
    expect(fetch.model).toBe("claude-fable-5");
    expect(fetch.skills).toEqual(["research"]);
    expect(fetch.systemPromptCount).toBe(2);
    expect(fetch.systemPromptChars).toBe("be thorough".length + "cite sources".length);
    expect(fetch.contextChars).toBeGreaterThan(0);
    expect(fetch.stateFrom).toBe("none");
    const review = digest.steps[1];
    expect(review.adapterKey).toBe("approval");
    expect(review.dependsOn).toEqual(["fetch"]);
  });

  it("truncates long free-text fields at 500 chars with a marker", () => {
    const workflow = demoWorkflow();
    workflow.steps[0].objective = "x".repeat(600);
    const digest = buildWorkflowDigest(workflow);
    const objective = digest.steps[0].objective ?? "";
    expect(objective.length).toBeLessThan(600);
    expect(objective).toContain("[truncated, 600 chars total]");
  });

  it("produces identical digests for JSON and Markdown formats", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { parseWorkflowFile } = await import("../src/parser.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-judge-digest-"));
    try {
      const definition = demoWorkflow();
      const jsonPath = path.join(dir, "wf.json");
      fs.writeFileSync(jsonPath, JSON.stringify(definition, null, 2));
      const mdPath = path.join(dir, "wf.md");
      const yaml = [
        "---",
        "key: demo",
        "title: Demo",
        "objectives:",
        "  - ship it",
        "steps:",
        "  - key: fetch",
        "    kind: task",
        "    objective: Fetch the sources",
        "    taskSpec:",
        "      adapterKey: mock",
        "      init:",
        "        model: claude-fable-5",
        "        skills: [research]",
        "        systemPrompts: [be thorough, cite sources]",
        "        context:",
        "          urls: [\"https://example.com\"]",
        "        stateFrom: none",
        "  - key: review",
        "    kind: approval",
        "    dependsOn: [fetch]",
        "---",
        "# Demo",
      ].join("\n");
      fs.writeFileSync(mdPath, yaml);
      const fromJson = buildWorkflowDigest(parseWorkflowFile(jsonPath));
      const fromMd = buildWorkflowDigest(parseWorkflowFile(mdPath));
      expect(fromMd).toEqual(fromJson);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

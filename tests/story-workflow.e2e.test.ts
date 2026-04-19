import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow } from "../src/engine.ts";
import { parseWorkflowFile } from "../src/parser.ts";
import type { WorkflowDefinition } from "../src/types.ts";

function withAdapter(workflow: WorkflowDefinition, adapterKey: "mock" | "opencode"): WorkflowDefinition {
  return {
    ...workflow,
    steps: workflow.steps.map((step) => {
      if (!step.taskSpec) return step;
      return {
        ...step,
        taskSpec: {
          ...step.taskSpec,
          adapterKey,
        },
      };
    }),
  };
}

function runStoryWorkflow(workflowPath: string, adapterKey: "mock" | "opencode" = "mock") {
  const inputPath = path.resolve("tests/fixtures/story-input.json");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as Record<string, unknown>;
  const workflow = withAdapter(parseWorkflowFile(path.resolve(workflowPath)), adapterKey);

  return runWorkflow(workflow, { input, autoConfirmAll: true });
}

function assertStoryResult(result: ReturnType<typeof runWorkflow>, adapterKey: "mock" | "opencode"): void {
  expect(result.status).toBe("succeeded");
  expect(result.events.some((event) => event.type === "run.failed")).toBe(false);

  const validationStep = result.stepRuns.find((step) => step.stepKey === "validate_story");
  expect(validationStep?.status).toBe("succeeded");
  expect(validationStep?.output?.validationPassed).toBe(true);

  const renderStep = result.stepRuns.find((step) => step.stepKey === "render_markdown");
  expect(renderStep?.status).toBe("succeeded");

  const markdown = String(renderStep?.output?.storyMarkdown ?? "");
  expect(markdown).toContain("## Chapter 1");
  expect(markdown).toContain("## Chapter 2");
  expect(markdown).toContain("bunny");

  const chapterMatches = markdown.match(/^## Chapter\s+\d+/gm) ?? [];
  expect(chapterMatches.length).toBe(2);

  const executionEvents = result.events.filter((event) => event.type === "step.execution_finished");
  expect(executionEvents.length).toBeGreaterThan(0);
  for (const event of executionEvents) {
    expect(event.payload.adapter).toBe(adapterKey);
  }
}

describe("story workflow e2e", () => {
  it("runs the story workflow from JSON", () => {
    const result = runStoryWorkflow("tests/fixtures/story-workflow.json");
    assertStoryResult(result, "mock");
  });

  it("runs the story workflow from Markdown", () => {
    const result = runStoryWorkflow("tests/fixtures/story-workflow.md");
    assertStoryResult(result, "mock");
  });

  it("runs the JSON story workflow using opencode adapter", () => {
    const result = runStoryWorkflow("tests/fixtures/story-workflow.json", "opencode");
    assertStoryResult(result, "opencode");
  });

  it("runs the Markdown story workflow using opencode adapter", () => {
    const result = runStoryWorkflow("tests/fixtures/story-workflow.md", "opencode");
    assertStoryResult(result, "opencode");
  });
});

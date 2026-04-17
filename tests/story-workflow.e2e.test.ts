import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow } from "../src/engine.ts";
import { parseWorkflowFile } from "../src/parser.ts";

function runStoryWorkflow(workflowPath: string) {
  const inputPath = path.resolve("tests/fixtures/story-input.json");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as Record<string, unknown>;
  const workflow = parseWorkflowFile(path.resolve(workflowPath));

  return runWorkflow(workflow, { input, autoConfirmAll: true });
}

function assertStoryResult(result: ReturnType<typeof runWorkflow>): void {
  expect(result.status).toBe("succeeded");

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
}

describe("story workflow e2e", () => {
  it("runs the story workflow from JSON", () => {
    const result = runStoryWorkflow("tests/fixtures/story-workflow.json");
    assertStoryResult(result);
  });

  it("runs the story workflow from Markdown", () => {
    const result = runStoryWorkflow("tests/fixtures/story-workflow.md");
    assertStoryResult(result);
  });
});

import { describe, expect, it } from "bun:test";
import { executeMockStep } from "../src/mockExecutor.ts";
import type { InputEnvelope, StepDefinition } from "../src/types.ts";

function baseInput(previousOutput: Record<string, unknown> = {}, globalState: Record<string, unknown> = {}): InputEnvelope {
  return {
    global_context: {
      workflow_id: "run-1",
      primary_objective: "Write a bunny story",
      workflow_objectives: ["story"],
      global_state: globalState,
    },
    step_context: {
      step_id: "step-1",
      step_objective: "Do work",
      previous_output: previousOutput,
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: [],
      mcp_endpoints: [],
      system_prompts: [],
      adapter: "mock",
    },
  };
}

describe("mockExecutor story helpers", () => {
  it("generates a bunny chapter markdown payload", () => {
    const step: StepDefinition = {
      key: "chapter_one",
      kind: "task",
      taskSpec: { adapterKey: "mock", payload: { storyChapter: 1 } },
    };

    const output = executeMockStep(step, baseInput({}, { storyRequest: "Bunny quest" }), 1);
    expect(output.execution_status).toBe("SUCCESS");
    expect(String(output.mutated_payload.chapterMarkdown)).toContain("## Chapter 1");
    expect(String(output.mutated_payload.chapterMarkdown)).toContain("bunny");
  });

  it("validates exactly two bunny chapters from previous output", () => {
    const step: StepDefinition = {
      key: "validate_story",
      kind: "task",
      taskSpec: { adapterKey: "mock", payload: { validateStory: true, requiredChapters: 2 } },
    };

    const previousOutput = {
      chapter_one: { chapterMarkdown: "## Chapter 1\n\nA bunny starts." },
      chapter_two: { chapterMarkdown: "## Chapter 2\n\nThe bunny succeeds." },
    };
    const output = executeMockStep(step, baseInput(previousOutput), 1);
    expect(output.execution_status).toBe("SUCCESS");
    expect(output.mutated_payload.validationPassed).toBe(true);
  });

  it("rejects validation when chapters are missing", () => {
    const step: StepDefinition = {
      key: "validate_story",
      kind: "task",
      taskSpec: { adapterKey: "mock", payload: { validateStory: true, requiredChapters: 2 } },
    };

    const previousOutput = {
      chapter_one: { chapterMarkdown: "## Chapter 1\n\nA bunny starts." },
    };
    const output = executeMockStep(step, baseInput(previousOutput), 1);
    expect(output.execution_status).toBe("QA_REJECTED");
    expect(output.qa_routing.action).toBe("RETRY_CURRENT");
  });

  it("renders final markdown with both chapters", () => {
    const step: StepDefinition = {
      key: "render_markdown",
      kind: "task",
      taskSpec: { adapterKey: "mock", payload: { renderStoryMarkdown: true, storyTitle: "The Bunny Adventure" } },
    };

    const previousOutput = {
      chapter_one: { chapterNumber: 1, chapterMarkdown: "## Chapter 1\n\nA bunny starts." },
      chapter_two: { chapterNumber: 2, chapterMarkdown: "## Chapter 2\n\nThe bunny succeeds." },
    };
    const output = executeMockStep(step, baseInput(previousOutput), 1);
    expect(output.execution_status).toBe("SUCCESS");
    const markdown = String(output.mutated_payload.storyMarkdown);
    expect(markdown).toContain("# The Bunny Adventure");
    expect(markdown).toContain("## Chapter 1");
    expect(markdown).toContain("## Chapter 2");
  });
});

import { describe, expect, it } from "bun:test";
import { executeClaudeCodeStep, normalizeTimeout, shouldUseRealClaudeCode } from "../src/claudeCodeExecutor.ts";
import type { InputEnvelope, StepDefinition, WorkflowDefinition } from "../src/types.ts";

function baseInput(overrides: Partial<InputEnvelope["global_context"]["global_state"]> = {}): InputEnvelope {
  return {
    global_context: {
      workflow_id: "run-1",
      primary_objective: "test workflow",
      workflow_objectives: [],
      global_state: { ...overrides },
    },
    step_context: {
      step_id: "spec",
      step_objective: "Write a spec for the feature",
      previous_output: {},
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: [],
      mcp_endpoints: [],
      system_prompts: [],
      adapter: "claude-code",
    },
  };
}

function baseStep(payloadOverrides: Record<string, unknown> = {}): StepDefinition {
  return {
    key: "spec",
    kind: "task",
    taskSpec: {
      adapterKey: "claude-code",
      init: { skills: [], systemPrompts: [] },
      payload: {
        useRealAdapter: true,
        timeoutMs: 1, // always times out — tests prompt content without real API calls
        ...payloadOverrides,
      },
    },
  };
}

describe("shouldUseRealClaudeCode", () => {
  it("returns false when useRealAdapter is not set", () => {
    expect(shouldUseRealClaudeCode({ key: "s", kind: "task" })).toBe(false);
  });

  it("returns false when useRealAdapter is false", () => {
    const step: StepDefinition = { key: "s", kind: "task", taskSpec: { payload: { useRealAdapter: false } } };
    expect(shouldUseRealClaudeCode(step)).toBe(false);
  });

  it("returns true when useRealAdapter is true", () => {
    const step: StepDefinition = { key: "s", kind: "task", taskSpec: { payload: { useRealAdapter: true } } };
    expect(shouldUseRealClaudeCode(step)).toBe(true);
  });
});

describe("executeClaudeCodeStep — output shape", () => {
  it("always returns a complete OutputEnvelope without throwing", async () => {
    const result = await executeClaudeCodeStep(baseStep(), baseInput(), 1);
    expect(result.step_id).toBe("spec");
    expect(result.execution_status).toBeOneOf(["SUCCESS", "FAILED", "QA_REJECTED", "YIELD_EXTERNAL"]);
    expect(result.qa_routing.action).toBeDefined();
    expect(typeof result.metadata.execution_time_ms).toBe("number");
  });

  it("sets adapter to claude-code in mutated_payload", async () => {
    const result = await executeClaudeCodeStep(baseStep(), baseInput(), 1);
    expect(result.mutated_payload.adapter).toBe("claude-code");
  });

  it("reflects the attempt number in mutated_payload", async () => {
    const result = await executeClaudeCodeStep(baseStep(), baseInput(), 3);
    expect(result.mutated_payload.attempt).toBe(3);
  });

  it("handles invalid timeout without throwing", () => {
    expect(normalizeTimeout("not-a-number")).toBe(120000);
    expect(normalizeTimeout(-1)).toBe(120000);
    expect(normalizeTimeout(0)).toBe(120000);
    expect(normalizeTimeout(5000)).toBe(5000);
  });
});

describe("executeClaudeCodeStep — prompt construction", () => {
  it("includes step objective in prompt", async () => {
    const result = await executeClaudeCodeStep(baseStep(), baseInput(), 1);
    expect(String(result.mutated_payload.prompt)).toContain("Write a spec for the feature");
  });

  it("includes system prompts", async () => {
    const input = baseInput();
    input.priming_configuration.system_prompts = ["You are a senior engineer."];
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    expect(String(result.mutated_payload.prompt)).toContain("You are a senior engineer.");
  });

  it("includes required skills", async () => {
    const input = baseInput();
    input.priming_configuration.required_skills = ["spec-driven-development"];
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    expect(String(result.mutated_payload.prompt)).toContain("spec-driven-development");
  });

  it("injects primitive global state as input variables", async () => {
    const result = await executeClaudeCodeStep(baseStep(), baseInput({ feature: "todo CLI" }), 1);
    expect(String(result.mutated_payload.prompt)).toContain("feature: todo CLI");
  });

  it("does not inject step output objects as input variables", async () => {
    const input = baseInput({ spec: { stepKey: "spec", adapter: "claude-code", output: "some spec" } });
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    // step output objects should not appear as flat Input: lines
    expect(String(result.mutated_payload.prompt)).not.toContain("Input:\nspec:");
  });

  it("injects previous step output into prompt", async () => {
    const input = baseInput();
    input.step_context.previous_output = {
      spec: { stepKey: "spec", adapter: "claude-code", output: "## Objective\nBuild a thing." },
    };
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    expect(String(result.mutated_payload.prompt)).toContain("Output from spec:");
    expect(String(result.mutated_payload.prompt)).toContain("## Objective");
  });

  it("skips previous steps that have no string output field", async () => {
    const input = baseInput();
    input.step_context.previous_output = {
      spec_gate: { stepKey: "spec_gate", adapter: "mock", mockResult: "success" },
    };
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    expect(String(result.mutated_payload.prompt)).not.toContain("Output from spec_gate:");
  });

  it("injects text fields from non-claude previous step outputs", async () => {
    const input = baseInput();
    input.step_context.previous_output = {
      render_story: { stepKey: "render_story", adapter: "mock", storyMarkdown: "# Story\n\nA bunny wins." },
      smoke_test: { stepKey: "smoke_test", adapter: "opencode", stdout: "All checks passed" },
    };
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    expect(String(result.mutated_payload.prompt)).toContain("# Story");
    expect(String(result.mutated_payload.prompt)).toContain("All checks passed");
  });

  it("uses explicit payload.prompt override instead of building", async () => {
    const step = baseStep({ prompt: "Do exactly this thing." });
    const result = await executeClaudeCodeStep(step, baseInput(), 1);
    expect(String(result.mutated_payload.prompt)).toBe("Do exactly this thing.");
  });

  it("does not throw when payload.model is set", async () => {
    const step = baseStep({ model: "claude-opus-4-5" });
    const result = await executeClaudeCodeStep(step, baseInput(), 1);
    expect(result.step_id).toBe("spec");
    expect(result.mutated_payload.model).toBe("claude-opus-4-5");
  });

  it("prefers init.model passed through priming_configuration", async () => {
    const input = baseInput();
    input.priming_configuration.model = "claude-sonnet-4";
    const step = baseStep({ model: "claude-opus-4-5" });
    const result = await executeClaudeCodeStep(step, input, 1);
    expect(result.mutated_payload.model).toBe("claude-sonnet-4");
  });

  it("includes string context", async () => {
    const input = baseInput();
    input.priming_configuration.context = "Repo conventions: use ESM imports.";
    const result = await executeClaudeCodeStep(baseStep(), input, 1);
    expect(String(result.mutated_payload.prompt)).toContain("Context:\nRepo conventions: use ESM imports.");
  });
});

describe("executeClaudeCodeStep — skill resolution", () => {
  it("injects embedded skill content into the prompt", async () => {
    const input = baseInput();
    input.priming_configuration.required_skills = ["spec-driven-development"];
    const step = baseStep();
    const workflow: WorkflowDefinition = {
      key: "wf",
      title: "wf",
      steps: [],
      skills: {
        "spec-driven-development": { content: "# Spec-Driven\n\nApply this method." },
      },
    };
    const result = await executeClaudeCodeStep(step, input, 1, workflow, "/tmp/wf.json");
    expect(String(result.mutated_payload.prompt)).toContain("# Spec-Driven");
    expect(String(result.mutated_payload.prompt)).toContain("Apply this method.");
  });

  it("falls back to plain skill name line when skill is not resolved", async () => {
    const input = baseInput();
    input.priming_configuration.required_skills = ["unknown-skill"];
    const step = baseStep();
    const workflow: WorkflowDefinition = { key: "wf", title: "wf", steps: [], skills: {} };
    const result = await executeClaudeCodeStep(step, input, 1, workflow, "/tmp/nonexistent/wf.json");
    expect(String(result.mutated_payload.prompt)).toContain("Apply the following skills: unknown-skill");
  });
});

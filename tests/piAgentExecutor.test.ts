import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executePiAgentStep, normalizeTimeout } from "../src/piAgentExecutor.ts";
import type { InputEnvelope, StepDefinition } from "../src/types.ts";
import { fakePiAgentScript } from "./helpers/piAgentFake.ts";

function baseInput(): InputEnvelope {
  return {
    global_context: {
      workflow_id: "run-1",
      primary_objective: "test workflow",
      workflow_objectives: [],
      global_state: { feature: "PI Agent adapter" },
    },
    step_context: {
      step_id: "implement",
      step_objective: "Implement the feature",
      previous_output: {},
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: ["test-driven-development"],
      mcp_endpoints: ["filesystem"],
      system_prompts: ["Use TDD"],
      context: { repo: "workflow-manager" },
      adapter: "pi-agent",
      model: "openai/gpt-5.4-mini",
    },
  };
}

function baseStep(payloadOverrides: Record<string, unknown> = {}): StepDefinition {
  return {
    key: "implement",
    kind: "task",
    objective: "Implement the feature",
    taskSpec: {
      adapterKey: "pi-agent",
      payload: {
        timeoutMs: 5000,
        ...payloadOverrides,
      },
    },
  };
}

describe("piAgentExecutor", () => {
  it("normalizes invalid timeout values", () => {
    expect(normalizeTimeout("not-a-number")).toBe(600000);
    expect(normalizeTimeout(-1)).toBe(600000);
    expect(normalizeTimeout(0)).toBe(600000);
    expect(normalizeTimeout(5000)).toBe(5000);
  });

  it("returns a failed OutputEnvelope when the command cannot be spawned", async () => {
    const result = await executePiAgentStep(
      baseStep({ command: "/definitely/not/a/pi-agent", timeoutMs: 100 }),
      baseInput(),
      1
    );

    expect(result.step_id).toBe("implement");
    expect(result.execution_status).toBe("FAILED");
    expect(result.mutated_payload.adapter).toBe("pi-agent");
    expect(String(result.qa_routing.feedback_reason)).toContain("not");
  });

  it("writes input files and reads PI Agent output files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-test-"));
    const script = fakePiAgentScript(dir);

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir }),
      baseInput(),
      2
    );

    expect(result.execution_status).toBe("SUCCESS");
    expect(result.mutated_payload.sawSkills).toEqual(["test-driven-development"]);
    expect(result.mutated_payload.sawMcps).toEqual(["filesystem"]);
    expect(result.mutated_payload.sawSystemPrompts).toEqual(["Use TDD"]);
    expect(result.mutated_payload.sawContext).toEqual({ repo: "workflow-manager" });
    expect(result.mutated_payload.sawModel).toBe("openai/gpt-5.4-mini");
    expect(result.mutated_payload.sawAttempt).toBe(2);
  });
});

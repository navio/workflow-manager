import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { executeOpencodeStep } from "../src/opencodeExecutor.ts";
import type { InputEnvelope, StepDefinition } from "../src/types.ts";

function baseInput(): InputEnvelope {
  return {
    global_context: {
      workflow_id: "run-1",
      primary_objective: "test",
      workflow_objectives: [],
      global_state: {},
    },
    step_context: {
      step_id: "opencode_probe",
      step_objective: "probe",
      previous_output: {},
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: [],
      mcp_endpoints: [],
      system_prompts: [],
      adapter: "opencode",
    },
  };
}

describe("opencodeExecutor safety", () => {
  it("handles invalid timeout values without throwing", () => {
    const step: StepDefinition = {
      key: "opencode_probe",
      kind: "task",
      taskSpec: {
        adapterKey: "opencode",
        payload: {
          useRealAdapter: true,
          opencodeSmokeTest: true,
          timeoutMs: "abc",
          opencodeArgs: ["--version"],
        },
      },
    };

    const output = executeOpencodeStep(step, baseInput(), 1);
    expect(output.step_id).toBe("opencode_probe");
    expect(["SUCCESS", "FAILED", "QA_REJECTED"]).toContain(output.execution_status);
  });

  it("handles invalid regex patterns without crashing", () => {
    const step: StepDefinition = {
      key: "opencode_probe",
      kind: "task",
      taskSpec: {
        adapterKey: "opencode",
        payload: {
          useRealAdapter: true,
          opencodeSmokeTest: true,
          expectPattern: "(",
          opencodeArgs: ["--version"],
        },
      },
    };

    const output = executeOpencodeStep(step, baseInput(), 1);
    expect(output.step_id).toBe("opencode_probe");

    const probe = spawnSync("opencode", ["--version"], { encoding: "utf-8" });
    if (probe.status === 0 && !probe.error) {
      expect(output.execution_status).toBe("FAILED");
      expect(output.qa_routing.feedback_reason).toContain("Invalid expectPattern regex");
    }
  });
});

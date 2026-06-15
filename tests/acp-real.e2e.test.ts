import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { runWorkflow } from "../src/engine.ts";
import type { WorkflowDefinition } from "../src/types.ts";

// Opt-in: drives a real ACP agent. Set WFM_ACP_REAL=1 and WFM_ACP_COMMAND to an
// installed ACP agent (e.g. `gemini` with WFM_ACP_ARGS, or `claude-code-acp`).
const ENABLE_REAL_ACP = process.env.WFM_ACP_REAL === "1";
const ACP_COMMAND = process.env.WFM_ACP_COMMAND;
const ACP_ARGS = (process.env.WFM_ACP_ARGS ?? "").split(" ").filter(Boolean);

function ensureAgentAvailable(command: string): void {
  const probe = spawnSync(command, ["--version"], { encoding: "utf-8" });
  if (probe.error) {
    throw new Error(`WFM_ACP_REAL=1 set, but ACP agent "${command}" is unavailable: ${probe.error.message}`);
  }
}

describe("acp real adapter e2e", () => {
  it("runs a real ACP agent end to end when enabled", async () => {
    if (!ENABLE_REAL_ACP || !ACP_COMMAND) return;
    ensureAgentAvailable(ACP_COMMAND);

    const wf: WorkflowDefinition = {
      key: "acp-real-wf",
      title: "ACP Real WF",
      steps: [
        {
          key: "summarize",
          kind: "task",
          objective: "Reply with the single word ACK",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "acp",
            payload: {
              useRealAdapter: true,
              acpCommand: ACP_COMMAND,
              acpArgs: ACP_ARGS,
              acpPermissions: "allow",
              timeoutMs: 120000,
            },
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    const step = result.stepRuns.find((run) => run.stepKey === "summarize");
    expect(step?.status).toBe("succeeded");
    expect(String(step?.output?.adapter)).toBe("acp");
    expect(typeof step?.output?.output).toBe("string");
  });
});

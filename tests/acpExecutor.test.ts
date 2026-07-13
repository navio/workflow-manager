import { describe, expect, it } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeAcpStep, normalizeTimeout, resolveAcpCommand, shouldUseRealAcp } from "../src/acpExecutor.ts";
import type { InputEnvelope, StepDefinition } from "../src/types.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.ts");

function baseInput(overrides: Record<string, unknown> = {}): InputEnvelope {
  return {
    global_context: {
      workflow_id: "run-1",
      primary_objective: "test workflow",
      workflow_objectives: [],
      global_state: { ...overrides },
    },
    step_context: {
      step_id: "build",
      step_objective: "Build the feature",
      previous_output: {},
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: [],
      mcp_endpoints: [],
      system_prompts: [],
      adapter: "acp",
    },
  };
}

function fakeAgentStep(extraArgs: string[] = [], payloadOverrides: Record<string, unknown> = {}): StepDefinition {
  return {
    key: "build",
    kind: "task",
    taskSpec: {
      adapterKey: "acp",
      init: { skills: [], systemPrompts: [] },
      payload: {
        useRealAdapter: true,
        acpCommand: process.execPath,
        acpArgs: [FIXTURE, ...extraArgs],
        ...payloadOverrides,
      },
    },
  };
}

describe("resolveAcpCommand / shouldUseRealAcp", () => {
  it("uses payload.acpCommand with explicit args", () => {
    const cmd = resolveAcpCommand(
      { key: "s", kind: "task", taskSpec: { adapterKey: "acp", payload: { acpCommand: "my-agent", acpArgs: ["--x"] } } },
      {}
    );
    expect(cmd).toEqual({ command: "my-agent", args: ["--x"] });
  });

  it("falls back to a preset for claude-code", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "claude-code" } }, {});
    expect(cmd?.command).toBe("claude-code-acp");
  });

  it("falls back to a preset for codex", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "codex" } }, {});
    expect(cmd).toEqual({ command: "codex-acp", args: [] });
  });

  it("enables real ACP for codex with useRealAdapter alone", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "codex", payload: { useRealAdapter: true } } })).toBe(
      true
    );
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "codex" } })).toBe(false);
  });

  it("returns null for bare acp without configuration", () => {
    expect(resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "acp" } }, {})).toBeNull();
  });

  it("honors WFM_ACP_COMMAND from the environment", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "acp" } }, { WFM_ACP_COMMAND: "envagent" });
    expect(cmd?.command).toBe("envagent");
  });

  it("requires both useRealAdapter and a resolvable command", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "acp" } })).toBe(false);
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "acp", payload: { acpCommand: "x" } } })).toBe(false);
    expect(
      shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "acp", payload: { useRealAdapter: true, acpCommand: "x" } } })
    ).toBe(true);
  });

  it("normalizes invalid timeouts to the default", () => {
    expect(normalizeTimeout("not-a-number")).toBe(600000);
    expect(normalizeTimeout(0)).toBe(600000);
    expect(normalizeTimeout(5000)).toBe(5000);
  });
});

describe("executeAcpStep against a fake ACP agent", () => {
  it("streams agent output and returns SUCCESS on end_turn", async () => {
    const chunks: string[] = [];
    const result = await executeAcpStep(fakeAgentStep(["--text", "streamed-acp-output"]), baseInput(), 1, undefined, undefined, {
      onStdout: (chunk) => chunks.push(chunk),
    });

    expect(result.execution_status).toBe("SUCCESS");
    expect(result.qa_routing.action).toBe("PROCEED");
    expect(result.mutated_payload.adapter).toBe("acp");
    expect(result.mutated_payload.stopReason).toBe("end_turn");
    expect(String(result.mutated_payload.output)).toContain("streamed-acp-output");
    expect(chunks.join("")).toContain("streamed-acp-output");
  });

  it("maps a refusal stop reason to QA_REJECTED / RETRY_CURRENT", async () => {
    const result = await executeAcpStep(fakeAgentStep(["--stop", "refusal"]), baseInput(), 1);
    expect(result.execution_status).toBe("QA_REJECTED");
    expect(result.qa_routing.action).toBe("RETRY_CURRENT");
  });

  it("auto-approves permission requests by default", async () => {
    const result = await executeAcpStep(fakeAgentStep(["--permission", "--kind", "edit"]), baseInput(), 1);
    expect(String(result.mutated_payload.output)).toContain("PERMISSION:allow");
  });

  it("denies permission when acpPermissions is deny", async () => {
    const result = await executeAcpStep(
      fakeAgentStep(["--permission", "--kind", "edit"], { acpPermissions: "deny" }),
      baseInput(),
      1
    );
    expect(String(result.mutated_payload.output)).toContain("PERMISSION:deny");
  });

  it("allows reads and denies edits under the reads-only policy", async () => {
    const reads = await executeAcpStep(
      fakeAgentStep(["--permission", "--kind", "read"], { acpPermissions: "reads-only" }),
      baseInput(),
      1
    );
    expect(String(reads.mutated_payload.output)).toContain("PERMISSION:allow");

    const edits = await executeAcpStep(
      fakeAgentStep(["--permission", "--kind", "edit"], { acpPermissions: "reads-only" }),
      baseInput(),
      1
    );
    expect(String(edits.mutated_payload.output)).toContain("PERMISSION:deny");
  });

  it("returns FAILED when the agent command cannot be spawned", async () => {
    const result = await executeAcpStep(
      fakeAgentStep([], { acpCommand: "definitely-not-a-real-binary-xyz", acpArgs: [] }),
      baseInput(),
      1
    );
    expect(result.execution_status).toBe("FAILED");
  });
});

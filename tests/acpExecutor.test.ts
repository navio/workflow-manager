import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeAcpStep, normalizeTimeout, resolveAcpCommand, shouldUseRealAcp } from "../src/acpExecutor.ts";
import type { InputEnvelope, StepDefinition, WorkflowDefinition } from "../src/types.ts";

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

  it("falls back to a preset for kimi", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "kimi" } }, {});
    expect(cmd).toEqual({ command: "kimi", args: ["acp"] });
  });

  it("enables real ACP for kimi with useRealAdapter alone", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "kimi", payload: { useRealAdapter: true } } })).toBe(
      true
    );
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "kimi" } })).toBe(false);
  });

  it("falls back to a preset for gemini", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "gemini" } }, {});
    expect(cmd).toEqual({ command: "gemini", args: ["--acp"] });
  });

  it("enables real ACP for gemini with useRealAdapter alone", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "gemini", payload: { useRealAdapter: true } } })).toBe(
      true
    );
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "gemini" } })).toBe(false);
  });

  it("falls back to a preset for qwen", () => {
    const cmd = resolveAcpCommand({ key: "s", kind: "task", taskSpec: { adapterKey: "qwen" } }, {});
    expect(cmd).toEqual({ command: "qwen", args: ["--acp", "--experimental-skills"] });
  });

  it("enables real ACP for qwen with useRealAdapter alone", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "qwen", payload: { useRealAdapter: true } } })).toBe(
      true
    );
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "qwen" } })).toBe(false);
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

  it("enables real ACP for a bare opencode step by default", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "opencode" } })).toBe(true);
  });

  it("opts out of real ACP for opencode when useRealAdapter is false", () => {
    expect(
      shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "opencode", payload: { useRealAdapter: false } } })
    ).toBe(false);
  });

  it("keeps claude-code opt-in only (bare step stays mock)", () => {
    expect(shouldUseRealAcp({ key: "s", kind: "task", taskSpec: { adapterKey: "claude-code" } })).toBe(false);
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

describe("composePrompt / context assembly", () => {
  const workflow: WorkflowDefinition = {
    key: "wf",
    title: "wf",
    steps: [],
    skills: {
      greet: { content: "# Greet skill\nAlways say hello first." },
    },
  };
  const workflowFilePath = "/tmp/fake-workflow.json";

  function scopedInput(): InputEnvelope {
    return {
      global_context: {
        workflow_id: "run-1",
        primary_objective: "test workflow",
        workflow_objectives: [],
        global_state: { ticket: "ABC-123", unrelatedCount: 7 },
      },
      step_context: {
        step_id: "build",
        step_objective: "Build the feature",
        previous_output: { plan: { summary: "do the thing" } },
        assigned_node_type: "AGENT",
      },
      priming_configuration: {
        required_skills: ["greet"],
        mcp_endpoints: [],
        system_prompts: ["Be terse."],
        adapter: "acp",
      },
    };
  }

  it("assembles the prompt from every section and reports matching contextMetrics", async () => {
    const step = fakeAgentStep(["--text", "ok"]);
    const result = await executeAcpStep(step, scopedInput(), 1, workflow, workflowFilePath);

    const prompt = String(result.mutated_payload.prompt);
    expect(prompt).toContain("Be terse.");
    expect(prompt).toContain("Always say hello first.");
    expect(prompt).toContain("ticket: ABC-123");
    expect(prompt).toContain("Build the feature");
    expect(prompt).toContain("Output from plan:");
    expect(prompt).toContain("summary: do the thing");

    const metrics = result.mutated_payload.contextMetrics as {
      totalChars: number;
      sections: {
        systemPrompts: number;
        skills: { name: string; chars: number }[];
        globalState: number;
        previousOutput: number;
        context: number;
        objective: number;
      };
    };
    expect(metrics.sections.systemPrompts).toBe("Be terse.".length);
    expect(metrics.sections.skills).toEqual([{ name: "greet", chars: "# Greet skill\nAlways say hello first.".length }]);
    expect(metrics.sections.globalState).toBeGreaterThan(0);
    expect(metrics.sections.previousOutput).toBeGreaterThan(0);
    expect(metrics.sections.objective).toBe("Build the feature".length);
    const expectedTotal =
      metrics.sections.systemPrompts +
      metrics.sections.skills.reduce((sum, s) => sum + s.chars, 0) +
      metrics.sections.globalState +
      metrics.sections.previousOutput +
      metrics.sections.context +
      metrics.sections.objective;
    expect(metrics.totalChars).toBe(expectedTotal);
  });

  it("sends the client the exact prompt string recorded in mutated_payload", async () => {
    const captureFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wfm-acp-capture-")), "prompt.txt");
    const step = fakeAgentStep(["--text", "ok", "--capture-prompt-to", captureFile]);
    const result = await executeAcpStep(step, scopedInput(), 1, workflow, workflowFilePath);

    const received = fs.readFileSync(captureFile, "utf-8");
    expect(received).toBe(String(result.mutated_payload.prompt));
  });

  it("extracts per-key text sections from previous_output instead of dumping raw JSON", async () => {
    const step = fakeAgentStep(["--text", "ok"]);
    const input: InputEnvelope = {
      ...scopedInput(),
      step_context: {
        ...scopedInput().step_context,
        previous_output: { two: { output: "keep me" }, one: null },
      },
    };
    const result = await executeAcpStep(step, input, 1, workflow, workflowFilePath);

    const prompt = String(result.mutated_payload.prompt);
    expect(prompt).toContain("Output from two:\nkeep me");
    expect(prompt).not.toContain("Output from one:");
    expect(prompt).not.toContain('"output": "keep me"');
    expect(prompt).not.toContain("Previous step output:");
  });

  it("a manual prompt override skips section assembly but is still measured", async () => {
    const overridePrompt = "Do exactly this and nothing else.";
    const step = fakeAgentStep(["--text", "ok"], { prompt: overridePrompt });
    const result = await executeAcpStep(step, scopedInput(), 1, workflow, workflowFilePath);

    expect(result.mutated_payload.prompt).toBe(overridePrompt);
    const metrics = result.mutated_payload.contextMetrics as { totalChars: number; sections: Record<string, unknown> };
    expect(metrics.totalChars).toBe(overridePrompt.length);
    expect(metrics.sections.skills).toEqual([]);
    expect(metrics.sections.globalState).toBe(0);
  });
});

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adapterImplementationStatuses,
  adapterMockFallbackReason,
  adapterMockFallbackWarnings,
  runtimeDoctorChecks,
  validateRuntimeRequirements,
} from "../src/runtimePreflight.ts";
import type { StepDefinition, WorkflowDefinition } from "../src/types.ts";

function workflow(step: WorkflowDefinition["steps"][number]): WorkflowDefinition {
  return {
    key: "runtime-preflight-wf",
    title: "Runtime Preflight WF",
    steps: [step],
  };
}

function fakeExecutable(name: string): { dir: string; command: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-runtime-preflight-"));
  const command = path.join(dir, name);
  fs.writeFileSync(command, "#!/bin/sh\nexit 0\n", "utf-8");
  fs.chmodSync(command, 0o755);
  return { dir, command };
}

describe("runtime preflight", () => {
  it("fails when the default Pi command is not installed on the host", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "plan",
        kind: "task",
        taskSpec: {},
      }),
      { PATH: "" }
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('requires pi-agent command "pi"');
  });

  it("passes when a PI Agent step uses an executable command override", () => {
    const { command } = fakeExecutable("pi-agent-fake");
    const errors = validateRuntimeRequirements(
      workflow({
        key: "plan",
        kind: "task",
        taskSpec: {
          payload: { command },
        },
      }),
      { PATH: "" }
    );

    expect(errors).toEqual([]);
  });

  it("does not infer provider env keys for Pi steps because pi manages its own auth", () => {
    const { command } = fakeExecutable("pi-agent-fake");
    const errors = validateRuntimeRequirements(
      workflow({
        key: "plan",
        kind: "task",
        taskSpec: {
          init: { model: "openrouter/anthropic/claude-sonnet-4" },
          payload: { command },
        },
      }),
      { PATH: "" }
    );

    expect(errors).toEqual([]);
  });

  it("fails when explicit requiredEnv keys are missing", () => {
    const { command } = fakeExecutable("pi-agent-fake");
    const errors = validateRuntimeRequirements(
      workflow({
        key: "plan",
        kind: "task",
        taskSpec: {
          payload: { command, requiredEnv: ["CUSTOM_LLM_KEY"] },
        },
      }),
      { PATH: "" }
    );

    expect(errors).toEqual(["Step plan requires CUSTOM_LLM_KEY for pi-agent LLM access"]);
  });

  it("checks real OpenCode only when the real adapter is enabled (opencode runs real by default)", () => {
    const optOutErrors = validateRuntimeRequirements(
      workflow({
        key: "probe",
        kind: "task",
        taskSpec: {
          adapterKey: "opencode",
          payload: { useRealAdapter: false },
        },
      }),
      { PATH: "" }
    );
    const bareErrors = validateRuntimeRequirements(
      workflow({
        key: "probe",
        kind: "task",
        taskSpec: {
          adapterKey: "opencode",
        },
      }),
      { PATH: "" }
    );

    expect(optOutErrors).toEqual([]);
    expect(bareErrors[0]).toContain('requires opencode command "opencode"');
  });

  it("checks the legacy Claude Code host command and Anthropic key inference", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "review",
        kind: "task",
        taskSpec: {
          adapterKey: "claude-code",
          init: { model: "claude-sonnet-4" },
          payload: { legacyExecutor: true, useRealAdapter: true },
        },
      }),
      { PATH: "" }
    );

    expect(errors).toContain(
      'Step review requires claude-code command "claude", but it is not installed or not executable on this host'
    );
    expect(errors).toContain("Step review requires ANTHROPIC_API_KEY for claude-code LLM access");
  });

  it("checks an agent validator's real adapter requirements even when the step itself is mock", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "review",
        kind: "task",
        taskSpec: { adapterKey: "mock" },
        validation: { mode: "agent", agent: { adapterKey: "opencode" } },
      }),
      { PATH: "" }
    );

    expect(errors.some((error) => error.includes("(validator)"))).toBe(true);
    expect(errors.some((error) => error.includes('requires opencode command "opencode"'))).toBe(true);
  });

  it("does not check an agent validator that inherits the step's useRealAdapter: false opt-out", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "review",
        kind: "task",
        taskSpec: { adapterKey: "opencode", payload: { useRealAdapter: false } },
        validation: { mode: "agent" },
      }),
      { PATH: "" }
    );

    expect(errors).toEqual([]);
  });
});

describe("adapter mock fallback warnings", () => {
  const task = (taskSpec: StepDefinition["taskSpec"]): StepDefinition => ({
    key: "build",
    kind: "task",
    taskSpec,
  });

  it("warns when claude-code (an ACP preset) is selected without useRealAdapter", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "claude-code" }));
    expect(reason).toContain("adapterKey 'claude-code'");
    expect(reason).toContain("useRealAdapter: true");
  });

  it("does not warn when claude-code routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "claude-code", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("does not warn for a bare opencode step (runs real by default)", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "opencode" }))).toBeNull();
  });

  it("does not warn when opencode routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "opencode", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("does not warn when opencode explicitly opts out with useRealAdapter: false", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "opencode", payload: { useRealAdapter: false } }))).toBeNull();
  });

  it("warns when opencode names an ACP agent with no resolvable preset", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "opencode", payload: { acpAgent: "nonexistent-agent" } }));
    expect(reason).toContain("runs real by default");
    expect(reason).toContain("adapterKey 'opencode'");
  });

  it("warns when an ACP adapter sets useRealAdapter but resolves no agent command", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "acp", payload: { useRealAdapter: true } }));
    expect(reason).toContain("adapterKey 'acp'");
    expect(reason).toContain("acpCommand");
  });

  it("does not warn when acp resolves a real agent command", () => {
    expect(
      adapterMockFallbackReason(task({ adapterKey: "acp", payload: { useRealAdapter: true, acpCommand: "my-agent" } }))
    ).toBeNull();
  });

  it("does not warn for bare acp (intentional mock) or pi-agent/mock", () => {
    expect(adapterMockFallbackReason(task({}))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "pi-agent" }))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "mock" }))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "acp" }))).toBeNull();
  });

  it("warns when codex (an ACP preset) is selected without useRealAdapter", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "codex" }));
    expect(reason).toContain("adapterKey 'codex'");
    expect(reason).toContain("useRealAdapter: true");
  });

  it("does not warn when codex routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "codex", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("warns when kimi (an ACP preset) is selected without useRealAdapter", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "kimi" }));
    expect(reason).toContain("adapterKey 'kimi'");
    expect(reason).toContain("useRealAdapter: true");
  });

  it("does not warn when kimi routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "kimi", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("warns when gemini (an ACP preset) is selected without useRealAdapter", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "gemini" }));
    expect(reason).toContain("adapterKey 'gemini'");
    expect(reason).toContain("useRealAdapter: true");
  });

  it("does not warn when gemini routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "gemini", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("warns when qwen (an ACP preset) is selected without useRealAdapter", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "qwen" }));
    expect(reason).toContain("adapterKey 'qwen'");
    expect(reason).toContain("useRealAdapter: true");
  });

  it("does not warn when qwen routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "qwen", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("does not warn for non-task steps", () => {
    expect(adapterMockFallbackReason({ key: "gate", kind: "approval" })).toBeNull();
  });

  it("collects per-step warnings across a workflow", () => {
    const warnings = adapterMockFallbackWarnings({
      key: "wf",
      title: "WF",
      steps: [
        { key: "plan", kind: "task", taskSpec: {} },
        { key: "review", kind: "task", taskSpec: { adapterKey: "claude-code" } },
      ],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.stepKey).toBe("review");
    expect(warnings[0]?.adapter).toBe("claude-code");
  });

  it("warns about an agent validator that would run real when the step itself is mock", () => {
    const warnings = adapterMockFallbackWarnings({
      key: "wf",
      title: "WF",
      steps: [
        {
          key: "review",
          kind: "task",
          taskSpec: { adapterKey: "mock" },
          validation: { mode: "agent", agent: { adapterKey: "claude-code" } },
        },
      ],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.stepKey).toBe("review (validator)");
    expect(warnings[0]?.adapter).toBe("claude-code");
  });

  it("does not warn about a validator that inherits the step's useRealAdapter: false opt-out", () => {
    const warnings = adapterMockFallbackWarnings({
      key: "wf",
      title: "WF",
      steps: [
        {
          key: "review",
          kind: "task",
          taskSpec: { adapterKey: "opencode", payload: { useRealAdapter: false } },
          validation: { mode: "agent" },
        },
      ],
    });

    expect(warnings).toEqual([]);
  });
});

describe("ACP runtime preflight", () => {
  it("requires the resolved ACP agent command to exist on the host", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "build",
        kind: "task",
        taskSpec: { adapterKey: "acp", payload: { useRealAdapter: true, acpCommand: "definitely-missing-acp-agent" } },
      }),
      { PATH: "" }
    );

    expect(errors.some((error) => error.includes("acp") && error.includes("definitely-missing-acp-agent"))).toBe(true);
  });

  it("requires the codex-acp bridge on the host for real codex steps", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "implement",
        kind: "task",
        taskSpec: { adapterKey: "codex", payload: { useRealAdapter: true } },
      }),
      { PATH: "" }
    );

    expect(errors.some((error) => error.includes("codex") && error.includes("codex-acp"))).toBe(true);
  });

  it("requires the kimi CLI on the host for real kimi steps", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "implement",
        kind: "task",
        taskSpec: { adapterKey: "kimi", payload: { useRealAdapter: true } },
      }),
      { PATH: "" }
    );

    expect(errors.some((error) => error.includes("kimi") && error.includes('command "kimi"'))).toBe(true);
  });

  it("requires the gemini CLI on the host for real gemini steps", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "implement",
        kind: "task",
        taskSpec: { adapterKey: "gemini", payload: { useRealAdapter: true } },
      }),
      { PATH: "" }
    );

    expect(errors.some((error) => error.includes("gemini") && error.includes('command "gemini"'))).toBe(true);
  });

  it("requires the qwen CLI on the host for real qwen steps", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "implement",
        kind: "task",
        taskSpec: { adapterKey: "qwen", payload: { useRealAdapter: true } },
      }),
      { PATH: "" }
    );

    expect(errors.some((error) => error.includes("qwen") && error.includes('command "qwen"'))).toBe(true);
  });

  it("does not enforce provider keys for ACP steps (agents self-authenticate)", () => {
    const { command } = fakeExecutable("acp-agent");
    const errors = validateRuntimeRequirements(
      workflow({
        key: "build",
        kind: "task",
        taskSpec: {
          adapterKey: "acp",
          init: { model: "anthropic/claude-sonnet-4" },
          payload: { useRealAdapter: true, acpCommand: command },
        },
      }),
      { PATH: "" }
    );

    expect(errors).toEqual([]);
  });

  it("exposes an ACP command check in doctor output", () => {
    const checks = runtimeDoctorChecks({ PATH: "", WFM_ACP_COMMAND: "some-acp-agent" });
    const acpCheck = checks.find((check) => check.key === "acp");
    expect(acpCheck).toBeDefined();
    expect(acpCheck?.label).toContain("ACP");
  });

  it("labels the doctor OpenCode check without the legacy qualifier", () => {
    const checks = runtimeDoctorChecks({ PATH: "" });
    const opencodeCheck = checks.find((check) => check.key === "opencode");
    expect(opencodeCheck?.label).toBe("OpenCode command");
  });

  it("reports opencode as a real adapter in implementation statuses", () => {
    const statuses = adapterImplementationStatuses();
    const opencodeStatus = statuses.find((status) => status.adapter === "opencode");
    expect(opencodeStatus?.status).toBe("real");
  });

  it("exposes a kimi command check in doctor output", () => {
    const checks = runtimeDoctorChecks({ PATH: "" });
    const kimiCheck = checks.find((check) => check.key === "kimi");
    expect(kimiCheck).toBeDefined();
    expect(kimiCheck?.label).toBe("Kimi CLI");
  });

  it("reports kimi as a real adapter in implementation statuses", () => {
    const statuses = adapterImplementationStatuses();
    const kimiStatus = statuses.find((status) => status.adapter === "kimi");
    expect(kimiStatus?.status).toBe("real");
  });

  it("exposes a gemini command check in doctor output", () => {
    const checks = runtimeDoctorChecks({ PATH: "" });
    const geminiCheck = checks.find((check) => check.key === "gemini");
    expect(geminiCheck).toBeDefined();
    expect(geminiCheck?.label).toBe("Gemini CLI");
  });

  it("reports gemini as a real adapter in implementation statuses", () => {
    const statuses = adapterImplementationStatuses();
    const geminiStatus = statuses.find((status) => status.adapter === "gemini");
    expect(geminiStatus?.status).toBe("real");
  });

  it("exposes a qwen command check in doctor output", () => {
    const checks = runtimeDoctorChecks({ PATH: "" });
    const qwenCheck = checks.find((check) => check.key === "qwen");
    expect(qwenCheck).toBeDefined();
    expect(qwenCheck?.label).toBe("Qwen Code CLI");
  });

  it("reports qwen as a real adapter in implementation statuses", () => {
    const statuses = adapterImplementationStatuses();
    const qwenStatus = statuses.find((status) => status.adapter === "qwen");
    expect(qwenStatus?.status).toBe("real");
  });
});

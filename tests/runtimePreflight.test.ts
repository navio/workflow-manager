import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
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

  it("checks real OpenCode only when the real adapter is enabled", () => {
    const dryRunErrors = validateRuntimeRequirements(
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
    const realErrors = validateRuntimeRequirements(
      workflow({
        key: "probe",
        kind: "task",
        taskSpec: {
          adapterKey: "opencode",
          payload: { useRealAdapter: true, opencodeSmokeTest: true },
        },
      }),
      { PATH: "" }
    );

    expect(dryRunErrors).toEqual([]);
    expect(realErrors[0]).toContain('requires opencode command "opencode"');
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

  it("warns when opencode (an ACP preset) is selected without useRealAdapter", () => {
    const reason = adapterMockFallbackReason(task({ adapterKey: "opencode" }));
    expect(reason).toContain("adapterKey 'opencode'");
    expect(reason).toContain("useRealAdapter: true");
  });

  it("does not warn when opencode routes through ACP with useRealAdapter", () => {
    expect(adapterMockFallbackReason(task({ adapterKey: "opencode", payload: { useRealAdapter: true } }))).toBeNull();
  });

  it("does not warn for the legacy opencode executor when its flags are set", () => {
    expect(
      adapterMockFallbackReason(
        task({ adapterKey: "opencode", payload: { legacyExecutor: true, useRealAdapter: true, opencodeSmokeTest: true } })
      )
    ).toBeNull();
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

  it("does not warn for bare acp/codex (intentional mock) or pi-agent/mock", () => {
    expect(adapterMockFallbackReason(task({}))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "pi-agent" }))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "mock" }))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "acp" }))).toBeNull();
    expect(adapterMockFallbackReason(task({ adapterKey: "codex" }))).toBeNull();
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
});

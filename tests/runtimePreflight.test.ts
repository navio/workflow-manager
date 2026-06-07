import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateRuntimeRequirements } from "../src/runtimePreflight.ts";
import type { WorkflowDefinition } from "../src/types.ts";

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
  it("fails when the default PI Agent command is not installed on the host", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "plan",
        kind: "task",
        taskSpec: {},
      }),
      { PATH: "" }
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('requires pi-agent command "pi-agent"');
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

  it("fails when an inferred OpenRouter model key is missing", () => {
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

    expect(errors).toEqual(["Step plan requires OPENROUTER_API_KEY for pi-agent LLM access"]);
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

  it("checks real Claude Code host command and Anthropic key inference", () => {
    const errors = validateRuntimeRequirements(
      workflow({
        key: "review",
        kind: "task",
        taskSpec: {
          adapterKey: "claude-code",
          init: { model: "claude-sonnet-4" },
          payload: { useRealAdapter: true },
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

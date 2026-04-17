import { spawnSync } from "node:child_process";
import type { InputEnvelope, OutputEnvelope, StepDefinition } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function shouldUseRealOpencode(step: StepDefinition): boolean {
  const payload = asRecord(step.taskSpec?.payload);
  return payload.useRealAdapter === true && payload.opencodeSmokeTest === true;
}

export function executeOpencodeStep(step: StepDefinition, input: InputEnvelope, attempt: number): OutputEnvelope {
  const startedAt = Date.now();
  const payload = asRecord(step.taskSpec?.payload);
  const opencodeArgs = Array.isArray(payload.opencodeArgs)
    ? payload.opencodeArgs.map((arg) => String(arg))
    : ["--version"];
  const timeoutMs = Number(payload.timeoutMs ?? 15000);

  const child = spawnSync("opencode", opencodeArgs, {
    encoding: "utf-8",
    timeout: timeoutMs,
  });

  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  const status = typeof child.status === "number" ? child.status : 1;
  const output = `${stdout}\n${stderr}`;
  const expectContains = payload.expectContains ? String(payload.expectContains) : undefined;
  const expectPattern = payload.expectPattern ? String(payload.expectPattern) : undefined;
  const containsExpected = expectContains
    ? output.toLowerCase().includes(expectContains.toLowerCase())
    : true;
  const matchesPattern = expectPattern ? new RegExp(expectPattern).test(output) : true;

  if (child.error || status !== 0) {
    return {
      step_id: step.key,
      execution_status: "FAILED",
      qa_routing: {
        action: "PROCEED",
        feedback_reason: child.error?.message ?? `opencode exited with status ${status}`,
      },
      mutated_payload: {
        stepKey: step.key,
        attempt,
        adapter: input.priming_configuration.adapter ?? "opencode",
        realOpencode: true,
        command: "opencode",
        args: opencodeArgs,
        exitStatus: status,
        stdout,
        stderr,
      },
      metadata: {
        execution_time_ms: Date.now() - startedAt,
        external_intervention_required: false,
      },
    };
  }

  if (!containsExpected || !matchesPattern) {
    const feedback = !containsExpected
      ? `Output did not contain expected token: ${expectContains}`
      : `Output did not match expected pattern: ${expectPattern}`;
    return {
      step_id: step.key,
      execution_status: "QA_REJECTED",
      qa_routing: {
        action: "RETRY_CURRENT",
        feedback_reason: feedback,
      },
      mutated_payload: {
        stepKey: step.key,
        attempt,
        adapter: input.priming_configuration.adapter ?? "opencode",
        realOpencode: true,
        command: "opencode",
        args: opencodeArgs,
        exitStatus: status,
        stdout,
        stderr,
        containsExpected,
        matchesPattern,
      },
      metadata: {
        execution_time_ms: Date.now() - startedAt,
        external_intervention_required: false,
      },
    };
  }

  return {
    step_id: step.key,
    execution_status: "SUCCESS",
    qa_routing: {
      action: "PROCEED",
      feedback_reason: "",
    },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter: input.priming_configuration.adapter ?? "opencode",
      realOpencode: true,
      command: "opencode",
      args: opencodeArgs,
      exitStatus: status,
      stdout,
      stderr,
      containsExpected,
      matchesPattern,
    },
    metadata: {
      execution_time_ms: Date.now() - startedAt,
      external_intervention_required: false,
    },
  };
}

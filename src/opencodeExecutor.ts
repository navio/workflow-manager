import { spawn } from "node:child_process";
import type { InputEnvelope, OutputEnvelope, StepDefinition, StepExecutionHooks } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeTimeout(value: unknown, fallbackMs = 15000): number {
  const timeout = Number(value ?? fallbackMs);
  if (!Number.isFinite(timeout) || timeout < 0) {
    return fallbackMs;
  }

  return Math.floor(timeout);
}

export function shouldUseRealOpencode(step: StepDefinition): boolean {
  const payload = asRecord(step.taskSpec?.payload);
  return payload.useRealAdapter === true && payload.opencodeSmokeTest === true;
}

export function executeOpencodeStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  const startedAt = Date.now();
  const payload = asRecord(step.taskSpec?.payload);
  const opencodeArgs = Array.isArray(payload.opencodeArgs)
    ? payload.opencodeArgs.map((arg) => String(arg))
    : ["--version"];
  const timeoutMs = normalizeTimeout(payload.timeoutMs, 15000);

  const makeResult = (
    status: OutputEnvelope["execution_status"],
    feedbackReason: string,
    extra: Record<string, unknown> = {},
    action: OutputEnvelope["qa_routing"]["action"] = "PROCEED"
  ): OutputEnvelope => ({
    step_id: step.key,
    execution_status: status,
    qa_routing: {
      action,
      feedback_reason: feedbackReason,
    },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter: input.priming_configuration.adapter ?? "opencode",
      realOpencode: true,
      command: "opencode",
      args: opencodeArgs,
      ...extra,
    },
    metadata: {
      execution_time_ms: Date.now() - startedAt,
      external_intervention_required: false,
    },
  });

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("opencode", opencodeArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const result = makeResult("FAILED", (err as Error).message, { timeoutMs });
      hooks?.onFinished?.({ executionStatus: result.execution_status });
      resolve(result);
      return;
    }

    hooks?.onStarted?.({ command: "opencode", args: opencodeArgs, timeoutMs });

    const outChunks: string[] = [];
    const errChunks: string[] = [];

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      outChunks.push(chunk);
      hooks?.onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      errChunks.push(chunk);
      hooks?.onStderr?.(chunk);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const stdout = outChunks.join("");
      const stderr = errChunks.join("");
      const result = makeResult("FAILED", `timed out after ${timeoutMs}ms`, { timeoutMs, stdout, stderr });
      hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus: null, timedOut: true });
      resolve(result);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (timedOut) {
        return;
      }
      const stdout = outChunks.join("");
      const stderr = errChunks.join("");
      const result = makeResult("FAILED", err.message, { timeoutMs, stdout, stderr });
      hooks?.onFinished?.({ executionStatus: result.execution_status });
      resolve(result);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return;
      }
      const stdout = outChunks.join("");
      const stderr = errChunks.join("");
      const exitStatus = code ?? 1;
      const output = `${stdout}\n${stderr}`;
      const expectContains = payload.expectContains ? String(payload.expectContains) : undefined;
      const expectPattern = payload.expectPattern ? String(payload.expectPattern) : undefined;
      const containsExpected = expectContains
        ? output.toLowerCase().includes(expectContains.toLowerCase())
        : true;

      let matchesPattern = true;
      if (expectPattern) {
        try {
          matchesPattern = new RegExp(expectPattern).test(output);
        } catch (err) {
          const result = makeResult(
            "FAILED",
            `Invalid expectPattern regex: ${(err as Error).message}`,
            { exitStatus, stdout, stderr, expectPattern }
          );
          hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
          resolve(result);
          return;
        }
      }

      if (exitStatus !== 0) {
        const result = makeResult(
          "FAILED",
          `opencode exited with status ${exitStatus}`,
          { exitStatus, stdout, stderr }
        );
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
        return;
      }

      if (!containsExpected || !matchesPattern) {
        const feedback = !containsExpected
          ? `Output did not contain expected token: ${expectContains}`
          : `Output did not match expected pattern: ${expectPattern}`;
        const result = makeResult(
          "QA_REJECTED",
          feedback,
          { exitStatus, stdout, stderr, containsExpected, matchesPattern },
          "RETRY_CURRENT"
        );
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
        return;
      }

      const result = makeResult("SUCCESS", "", { exitStatus, stdout, stderr, containsExpected, matchesPattern });
      hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
      resolve(result);
    });
  });
}

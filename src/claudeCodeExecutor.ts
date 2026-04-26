import { spawn } from "node:child_process";
import type { InputEnvelope, OutputEnvelope, StepDefinition } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function normalizeTimeout(value: unknown, fallbackMs = 120000): number {
  const timeout = Number(value ?? fallbackMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return fallbackMs;
  return Math.floor(timeout);
}

function buildPrompt(step: StepDefinition, input: InputEnvelope): string {
  const payload = asRecord(step.taskSpec?.payload);

  if (typeof payload.prompt === "string" && payload.prompt.trim()) {
    return payload.prompt;
  }

  const parts: string[] = [];

  const systemPrompts = input.priming_configuration.system_prompts;
  if (systemPrompts.length > 0) {
    parts.push(systemPrompts.join("\n"));
  }

  const skills = input.priming_configuration.required_skills;
  if (skills.length > 0) {
    parts.push(`Apply the following skills: ${skills.join(", ")}`);
  }

  // Inject primitive user inputs (feature, ticket, etc.) — skip step output objects.
  // Newlines stripped from values to reduce prompt injection surface.
  const globalState = input.global_context.global_state;
  const inputLines = Object.entries(globalState)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}: ${String(v).replace(/[\n\r]/g, " ")}`);
  if (inputLines.length > 0) {
    parts.push(`Input:\n${inputLines.join("\n")}`);
  }

  parts.push(input.step_context.step_objective);

  // Inject output from previous steps so context flows forward
  const prev = input.step_context.previous_output;
  for (const [key, val] of Object.entries(prev)) {
    const rec = asRecord(val);
    if (typeof rec.output === "string" && rec.output.trim()) {
      parts.push(`Output from ${key}:\n${rec.output}`);
    }
  }

  const context = input.priming_configuration.context;
  if (context && typeof context === "object") {
    const str = JSON.stringify(context, null, 2);
    if (str !== "{}") parts.push(`Context:\n${str}`);
  }

  return parts.join("\n\n");
}

export function shouldUseRealClaudeCode(step: StepDefinition): boolean {
  const payload = asRecord(step.taskSpec?.payload);
  return payload.useRealAdapter === true;
}

export function executeClaudeCodeStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number
): Promise<OutputEnvelope> {
  const startedAt = Date.now();
  const payload = asRecord(step.taskSpec?.payload);
  const timeoutMs = normalizeTimeout(payload.timeoutMs);
  const prompt = buildPrompt(step, input);

  const args: string[] = ["-p", prompt];
  if (typeof payload.model === "string") {
    args.push("--model", payload.model);
  }

  const makeResult = (
    status: OutputEnvelope["execution_status"],
    reason: string,
    extra: Record<string, unknown> = {}
  ): OutputEnvelope => ({
    step_id: step.key,
    execution_status: status,
    qa_routing: { action: "PROCEED", feedback_reason: reason },
    mutated_payload: { stepKey: step.key, attempt, adapter: "claude-code", prompt, ...extra },
    metadata: { execution_time_ms: Date.now() - startedAt, external_intervention_required: false },
  });

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("claude", args);
    } catch (err) {
      resolve(makeResult("FAILED", (err as Error).message));
      return;
    }

    const outChunks: string[] = [];
    const errChunks: string[] = [];

    process.stderr.write(`\n─── step: ${step.key} (claude-code) ───\n`);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      outChunks.push(text);
      process.stderr.write(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      errChunks.push(text);
      process.stderr.write(text);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      resolve(makeResult("FAILED", `timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve(makeResult("FAILED", err.message));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      process.stderr.write(`\n─── end: ${step.key} ───\n`);
      const stdout = outChunks.join("");
      const stderr = errChunks.join("");
      const exitStatus = code ?? 1;

      if (exitStatus !== 0) {
        resolve(makeResult("FAILED", `claude exited ${exitStatus}: ${stderr.trim()}`, { exitStatus, stdout, stderr }));
      } else {
        resolve(makeResult("SUCCESS", "", { exitStatus, output: stdout.trim() }));
      }
    });
  });
}

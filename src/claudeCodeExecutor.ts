import { spawn } from "node:child_process";
import { type ContextMetrics, createContextMetricsBuilder } from "./contextMetrics.js";
import { previousOutputTextSections } from "./promptSections.js";
import { resolveSkill } from "./skillResolver.js";
import type { InputEnvelope, OutputEnvelope, StepDefinition, StepExecutionHooks, WorkflowDefinition } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function normalizeTimeout(value: unknown, fallbackMs = 120000): number {
  const timeout = Number(value ?? fallbackMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return fallbackMs;
  return Math.floor(timeout);
}

function buildPrompt(
  step: StepDefinition,
  input: InputEnvelope,
  workflow?: WorkflowDefinition,
  workflowFilePath?: string
): { prompt: string; metrics: ContextMetrics } {
  const payload = asRecord(step.taskSpec?.payload);
  const metrics = createContextMetricsBuilder();

  if (typeof payload.prompt === "string" && payload.prompt.trim()) {
    metrics.addContext(payload.prompt);
    return { prompt: payload.prompt, metrics: metrics.build() };
  }

  const parts: string[] = [];

  const systemPrompts = input.priming_configuration.system_prompts;
  if (systemPrompts.length > 0) {
    const joined = systemPrompts.join("\n");
    parts.push(joined);
    metrics.addSystemPrompts(joined);
  }

  const skills = input.priming_configuration.required_skills;
  if (skills.length > 0) {
    const resolvedNames: string[] = [];
    for (const name of skills) {
      const resolved =
        workflow && workflowFilePath ? resolveSkill(name, workflow, workflowFilePath) : null;
      if (resolved) {
        parts.push(resolved.content);
        metrics.addSkill(name, resolved.content);
      } else {
        resolvedNames.push(name);
      }
    }
    if (resolvedNames.length > 0) {
      parts.push(`Apply the following skills: ${resolvedNames.join(", ")}`);
    }
  }

  // Inject primitive user inputs (feature, ticket, etc.) — skip step output objects.
  // Newlines stripped from values to reduce prompt injection surface.
  const globalState = input.global_context.global_state;
  const inputLines = Object.entries(globalState)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}: ${String(v).replace(/[\n\r]/g, " ")}`);
  if (inputLines.length > 0) {
    const block = `Input:\n${inputLines.join("\n")}`;
    parts.push(block);
    metrics.addGlobalState(block);
  }

  parts.push(input.step_context.step_objective);
  metrics.addObjective(input.step_context.step_objective);

  // Inject output from previous steps so context flows forward
  const prev = input.step_context.previous_output;
  for (const [key, val] of Object.entries(prev)) {
    const sections = previousOutputTextSections(val);
    if (sections.length > 0) {
      const block = `Output from ${key}:\n${sections.join("\n\n")}`;
      parts.push(block);
      metrics.addPreviousOutput(block);
    }
  }

  const context = input.priming_configuration.context;
  if (typeof context === "string" && context.trim()) {
    const block = `Context:\n${context}`;
    parts.push(block);
    metrics.addContext(block);
  } else if (context && typeof context === "object") {
    const str = JSON.stringify(context, null, 2);
    if (str !== "{}") {
      const block = `Context:\n${str}`;
      parts.push(block);
      metrics.addContext(block);
    }
  }

  return { prompt: parts.join("\n\n"), metrics: metrics.build() };
}

export function shouldUseRealClaudeCode(step: StepDefinition): boolean {
  const payload = asRecord(step.taskSpec?.payload);
  return payload.useRealAdapter === true;
}

export interface ClaudeStreamActivity {
  activity?: string;
  assistantText?: string;
  resultText?: string;
}

function streamText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      const block = asRecord(item);
      return typeof block.text === "string" ? block.text : "";
    })
    .join("") || undefined;
}

export function claudeStreamActivity(line: string): ClaudeStreamActivity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const event = asRecord(parsed);
  const streamEvent = asRecord(event.event);
  const delta = asRecord(streamEvent.delta);
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return { activity: delta.text, assistantText: delta.text };
  }

  const contentBlock = asRecord(streamEvent.content_block);
  if (streamEvent.type === "content_block_start" && contentBlock.type === "tool_use") {
    const toolName = typeof contentBlock.name === "string" ? contentBlock.name : "tool";
    return { activity: `\n[claude tool] ${toolName} started\n` };
  }
  const result = typeof event.result === "string" ? event.result : streamText(event.message);
  if (event.type === "result" && result) {
    return { resultText: result };
  }
  return null;
}

export function executeClaudeCodeStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  workflow?: WorkflowDefinition,
  workflowFilePath?: string,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  const startedAt = Date.now();
  const payload = asRecord(step.taskSpec?.payload);
  const timeoutMs = normalizeTimeout(payload.timeoutMs);
  const { prompt, metrics: contextMetrics } = buildPrompt(step, input, workflow, workflowFilePath);
  const configuredModel =
    typeof input.priming_configuration.model === "string" && input.priming_configuration.model.trim()
      ? input.priming_configuration.model
      : typeof payload.model === "string" && payload.model.trim()
        ? payload.model
        : undefined;

  const args: string[] = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (configuredModel) {
    args.push("--model", configuredModel);
  }

  const makeResult = (
    status: OutputEnvelope["execution_status"],
    reason: string,
    extra: Record<string, unknown> = {}
  ): OutputEnvelope => ({
    step_id: step.key,
    execution_status: status,
    qa_routing: { action: "PROCEED", feedback_reason: reason },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter: "claude-code",
      prompt,
      model: configuredModel,
      contextMetrics,
      ...extra,
    },
    metadata: { execution_time_ms: Date.now() - startedAt, external_intervention_required: false },
  });

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("claude", args, { env: process.env });
    } catch (err) {
      resolve(makeResult("FAILED", (err as Error).message));
      return;
    }

    hooks?.onStarted?.({ command: "claude", args, model: configuredModel, contextMetrics, outputMode: "stream-json" });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(prompt);

    const outChunks: string[] = [];
    const assistantChunks: string[] = [];
    let finalResultText: string | undefined;
    const errChunks: string[] = [];
    let stdoutLineBuffer = "";

    const emitStdoutLine = (line: string): void => {
      const activity = claudeStreamActivity(line);
      if (!activity) {
        hooks?.onStdout?.(`${line}\n`);
        return;
      }
      if (activity.resultText) {
        finalResultText = activity.resultText;
        if (assistantChunks.length === 0) {
          hooks?.onStdout?.(activity.resultText);
        }
        return;
      }
      if (activity.assistantText) {
        assistantChunks.push(activity.assistantText);
      }
      if (activity.activity) {
        hooks?.onStdout?.(activity.activity);
      }
    };

    const flushStdoutLines = (final = false): void => {
      let newlineIndex = stdoutLineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutLineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        stdoutLineBuffer = stdoutLineBuffer.slice(newlineIndex + 1);
        if (line) emitStdoutLine(line);
        newlineIndex = stdoutLineBuffer.indexOf("\n");
      }
      if (final && stdoutLineBuffer) {
        emitStdoutLine(stdoutLineBuffer.replace(/\r$/, ""));
        stdoutLineBuffer = "";
      }
    };

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (text: string) => {
      outChunks.push(text);
      stdoutLineBuffer += text;
      flushStdoutLines();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      errChunks.push(text);
      hooks?.onStderr?.(text);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      flushStdoutLines(true);
      const result = makeResult("FAILED", `timed out after ${timeoutMs}ms`);
      hooks?.onFinished?.({ executionStatus: result.execution_status, timedOut: true });
      resolve(result);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      flushStdoutLines(true);
      const result = makeResult("FAILED", err.message);
      hooks?.onFinished?.({ executionStatus: result.execution_status });
      resolve(result);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      flushStdoutLines(true);
      const stdout = outChunks.join("");
      const stderr = errChunks.join("");
      const exitStatus = code ?? 1;

      if (exitStatus !== 0) {
        const result = makeResult("FAILED", `claude exited ${exitStatus}: ${stderr.trim()}`, { exitStatus, stdout, stderr });
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
      } else {
        const result = makeResult("SUCCESS", "", {
          exitStatus,
          output: assistantChunks.join("").trim() || finalResultText?.trim() || stdout.trim(),
        });
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
      }
    });
  });
}

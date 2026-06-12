import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSkill } from "./skillResolver.js";
import type { InputEnvelope, OutputEnvelope, StepDefinition, StepExecutionHooks, WorkflowDefinition } from "./types.js";

interface ResolvedPiSkill {
  name: string;
  origin: string;
  content: string;
}

interface PiAgentInputFile {
  input_envelope: InputEnvelope;
  step: StepDefinition;
  workflow?: Pick<WorkflowDefinition, "key" | "title" | "description" | "objectives" | "inputSchema" | "outputSchema">;
  resolved_skills: ResolvedPiSkill[];
  run: {
    attempt: number;
    runDir: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeTimeout(value: unknown, fallbackMs = 600000): number {
  const timeout = Number(value ?? fallbackMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return fallbackMs;
  return Math.floor(timeout);
}

function makeResult(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  startedAt: number,
  status: OutputEnvelope["execution_status"],
  reason: string,
  extra: Record<string, unknown> = {},
  action: OutputEnvelope["qa_routing"]["action"] = "PROCEED"
): OutputEnvelope {
  return {
    step_id: step.key,
    execution_status: status,
    qa_routing: { action, feedback_reason: reason },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter: input.priming_configuration.adapter ?? "pi-agent",
      ...extra,
    },
    metadata: {
      execution_time_ms: Date.now() - startedAt,
      external_intervention_required: false,
    },
  };
}

function resolveCommand(payload: Record<string, unknown>): string {
  if (typeof payload.command === "string" && payload.command.trim()) return payload.command;
  if (process.env.WFM_PI_AGENT_COMMAND?.trim()) return process.env.WFM_PI_AGENT_COMMAND;
  return "pi-agent";
}

function resolveArgs(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.args) ? payload.args.map((arg) => String(arg)) : [];
}

function resolveRunDir(payload: Record<string, unknown>): string {
  if (typeof payload.runDir === "string" && payload.runDir.trim()) {
    fs.mkdirSync(payload.runDir, { recursive: true });
    return payload.runDir;
  }

  return fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-"));
}

function buildInputFile(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  runDir: string,
  workflow?: WorkflowDefinition,
  workflowFilePath?: string
): PiAgentInputFile {
  const resolvedSkills: ResolvedPiSkill[] = [];
  if (workflow && workflowFilePath) {
    for (const name of input.priming_configuration.required_skills) {
      const resolved = resolveSkill(name, workflow, workflowFilePath);
      if (resolved) {
        resolvedSkills.push({ name, origin: resolved.origin, content: resolved.content });
      }
    }
  }

  return {
    input_envelope: input,
    step,
    workflow: workflow
      ? {
          key: workflow.key,
          title: workflow.title,
          description: workflow.description,
          objectives: workflow.objectives,
          inputSchema: workflow.inputSchema,
          outputSchema: workflow.outputSchema,
        }
      : undefined,
    resolved_skills: resolvedSkills,
    run: { attempt, runDir },
  };
}

function appendPrimingArgs(args: string[], input: InputEnvelope): void {
  for (const skill of input.priming_configuration.required_skills) args.push("--skill", skill);
  for (const mcp of input.priming_configuration.mcp_endpoints) args.push("--mcp", mcp);
  for (const prompt of input.priming_configuration.system_prompts) args.push("--system-prompt", prompt);
  if (input.priming_configuration.model) args.push("--model", input.priming_configuration.model);
}

function normalizeOutputEnvelope(
  raw: unknown,
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  startedAt: number
): OutputEnvelope {
  const record = asRecord(raw);
  const metadata = asRecord(record.metadata);
  const qaRouting = asRecord(record.qa_routing);
  const status = String(record.execution_status ?? "SUCCESS") as OutputEnvelope["execution_status"];
  const action = String(qaRouting.action ?? "PROCEED") as OutputEnvelope["qa_routing"]["action"];

  return {
    step_id: typeof record.step_id === "string" && record.step_id.trim() ? record.step_id : step.key,
    execution_status: status,
    qa_routing: {
      action,
      feedback_reason: typeof qaRouting.feedback_reason === "string" ? qaRouting.feedback_reason : "",
    },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter: input.priming_configuration.adapter ?? "pi-agent",
      ...asRecord(record.mutated_payload),
    },
    metadata: {
      execution_time_ms:
        typeof metadata.execution_time_ms === "number" ? metadata.execution_time_ms : Date.now() - startedAt,
      external_intervention_required: metadata.external_intervention_required === true,
      intervention_details: asRecord(metadata.intervention_details),
    },
  };
}

export function executePiAgentStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  workflow?: WorkflowDefinition,
  workflowFilePath?: string,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  const startedAt = Date.now();
  let payload: Record<string, unknown>;
  let timeoutMs: number;
  let runDir: string;
  let inputPath: string;
  let outputPath: string;
  let command: string;
  let args: string[];

  try {
    payload = asRecord(step.taskSpec?.payload);
    timeoutMs = normalizeTimeout(payload.timeoutMs);
    runDir = resolveRunDir(payload);
    inputPath = path.join(runDir, "input.json");
    outputPath = path.join(runDir, "output.json");
    // A fixed runDir is reused across attempts; a leftover output.json would be
    // read as this attempt's result if the agent exits 0 without writing one.
    fs.rmSync(outputPath, { force: true });
    command = resolveCommand(payload);
    args = resolveArgs(payload);
    args.push("--input", inputPath, "--output", outputPath);
    appendPrimingArgs(args, input);

    fs.writeFileSync(
      inputPath,
      JSON.stringify(buildInputFile(step, input, attempt, runDir, workflow, workflowFilePath), null, 2),
      "utf-8"
    );
  } catch (err) {
    const result = makeResult(step, input, attempt, startedAt, "FAILED", `PI Agent setup failed: ${(err as Error).message}`);
    hooks?.onFinished?.({ executionStatus: result.execution_status });
    return Promise.resolve(result);
  }

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve(
        makeResult(step, input, attempt, startedAt, "FAILED", (err as Error).message, {
          command,
          args,
          inputPath,
          outputPath,
          timeoutMs,
        })
      );
      return;
    }

    hooks?.onStarted?.({ command, args, inputPath, outputPath, timeoutMs });

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
      const result = makeResult(
        step,
        input,
        attempt,
        startedAt,
        "FAILED",
        `timed out after ${timeoutMs}ms`,
        { command, args, inputPath, outputPath, timeoutMs, stdout: outChunks.join(""), stderr: errChunks.join("") }
      );
      hooks?.onFinished?.({ executionStatus: result.execution_status, timedOut: true });
      resolve(result);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      const result = makeResult(step, input, attempt, startedAt, "FAILED", err.message, {
        command,
        args,
        inputPath,
        outputPath,
        timeoutMs,
        stdout: outChunks.join(""),
        stderr: errChunks.join(""),
      });
      hooks?.onFinished?.({ executionStatus: result.execution_status });
      resolve(result);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      const stdout = outChunks.join("");
      const stderr = errChunks.join("");
      const exitStatus = code ?? 1;

      if (exitStatus !== 0) {
        const result = makeResult(step, input, attempt, startedAt, "FAILED", `${command} exited with status ${exitStatus}`, {
          command,
          args,
          inputPath,
          outputPath,
          exitStatus,
          stdout,
          stderr,
        });
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
        return;
      }

      if (!fs.existsSync(outputPath)) {
        const result = makeResult(step, input, attempt, startedAt, "FAILED", `PI Agent output file not found: ${outputPath}`, {
          command,
          args,
          inputPath,
          outputPath,
          exitStatus,
          stdout,
          stderr,
        });
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
        return;
      }

      try {
        const rawOutput = JSON.parse(fs.readFileSync(outputPath, "utf-8")) as unknown;
        const result = normalizeOutputEnvelope(rawOutput, step, input, attempt, startedAt);
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
      } catch (err) {
        const result = makeResult(step, input, attempt, startedAt, "FAILED", `Invalid PI Agent output: ${(err as Error).message}`, {
          command,
          args,
          inputPath,
          outputPath,
          exitStatus,
          stdout,
          stderr,
        });
        hooks?.onFinished?.({ executionStatus: result.execution_status, exitStatus });
        resolve(result);
      }
    });
  });
}

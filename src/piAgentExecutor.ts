import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSkill } from "./skillResolver.js";
import type { InputEnvelope, OutputEnvelope, StepDefinition, StepExecutionHooks, WorkflowDefinition } from "./types.js";

export const DEFAULT_PI_COMMAND = "pi";

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
  return DEFAULT_PI_COMMAND;
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

function sanitizeSkillName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return safe || "skill";
}

function writeSkillFiles(runDir: string, skills: ResolvedPiSkill[]): string[] {
  const skillPaths: string[] = [];
  skills.forEach((skill, index) => {
    const skillDir = path.join(runDir, "skills", `${index}-${sanitizeSkillName(skill.name)}`);
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillPath, skill.content, "utf-8");
    skillPaths.push(skillPath);
  });
  return skillPaths;
}

function describeContext(context: InputEnvelope["priming_configuration"]["context"]): string | null {
  if (typeof context === "string") {
    return context.trim() ? context : null;
  }
  if (context && Object.keys(context).length > 0) {
    return JSON.stringify(context, null, 2);
  }
  return null;
}

function buildPrompt(step: StepDefinition, input: InputEnvelope, inputPath: string, outputPath: string): string {
  const lines: string[] = ["You are executing a single step of an orchestrated workflow run."];

  if (input.global_context.primary_objective.trim()) {
    lines.push("", `Workflow objective: ${input.global_context.primary_objective}`);
  }
  if (input.global_context.workflow_objectives.length > 0) {
    lines.push(`Workflow goals: ${input.global_context.workflow_objectives.join("; ")}`);
  }

  lines.push("", `Step key: ${step.key}`);
  const objective = step.objective ?? input.step_context.step_objective;
  if (objective.trim()) {
    lines.push(`Step objective: ${objective}`);
  }

  if (Object.keys(input.step_context.previous_output).length > 0) {
    lines.push("", "Previous step output:", JSON.stringify(input.step_context.previous_output, null, 2));
  }

  const context = describeContext(input.priming_configuration.context);
  if (context) {
    lines.push("", "Additional context:", context);
  }

  if (input.priming_configuration.mcp_endpoints.length > 0) {
    lines.push("", `MCP endpoints declared for this step: ${input.priming_configuration.mcp_endpoints.join(", ")}`);
  }

  lines.push(
    "",
    `The full structured step input is available at ${inputPath}.`,
    "",
    "Complete the step objective now.",
    `When you are done, write a JSON result envelope to ${outputPath} with this shape:`,
    `{"step_id":"${step.key}","execution_status":"SUCCESS"|"FAILED"|"QA_REJECTED","qa_routing":{"action":"PROCEED"|"RETRY_CURRENT"|"ROLLBACK_PREVIOUS"|"RESTART_ALL","feedback_reason":"<short reason>"},"mutated_payload":{<step results>},"metadata":{"execution_time_ms":0,"external_intervention_required":false}}`,
    "If you cannot write that file, simply finish with a clear final response; a successful exit is recorded as step success and your response text becomes the step output."
  );

  return lines.join("\n");
}

function buildPiArgs(
  payload: Record<string, unknown>,
  input: InputEnvelope,
  skillPaths: string[],
  prompt: string
): string[] {
  const args = resolveArgs(payload);
  args.push("--print", "--no-session");
  if (input.priming_configuration.model) {
    args.push("--model", input.priming_configuration.model);
  }
  for (const systemPrompt of input.priming_configuration.system_prompts) {
    args.push("--append-system-prompt", systemPrompt);
  }
  for (const skillPath of skillPaths) {
    args.push("--skill", skillPath);
  }
  args.push(prompt);
  return args;
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

    const inputFile = buildInputFile(step, input, attempt, runDir, workflow, workflowFilePath);
    fs.writeFileSync(inputPath, JSON.stringify(inputFile, null, 2), "utf-8");

    const skillPaths = writeSkillFiles(runDir, inputFile.resolved_skills);
    const prompt = buildPrompt(step, input, inputPath, outputPath);
    fs.writeFileSync(path.join(runDir, "prompt.txt"), prompt, "utf-8");
    args = buildPiArgs(payload, input, skillPaths, prompt);
  } catch (err) {
    const result = makeResult(step, input, attempt, startedAt, "FAILED", `Pi setup failed: ${(err as Error).message}`);
    hooks?.onFinished?.({ executionStatus: result.execution_status });
    return Promise.resolve(result);
  }

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WFM_PI_INPUT_FILE: inputPath, WFM_PI_OUTPUT_FILE: outputPath },
      });
    } catch (err) {
      resolve(
        makeResult(step, input, attempt, startedAt, "FAILED", (err as Error).message, {
          command,
          inputPath,
          outputPath,
          timeoutMs,
        })
      );
      return;
    }

    hooks?.onStarted?.({ command, inputPath, outputPath, timeoutMs });

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
      const terminationSignal = "SIGTERM";
      child.kill(terminationSignal);
      const result = makeResult(
        step,
        input,
        attempt,
        startedAt,
        "FAILED",
        `timed out after ${timeoutMs}ms`,
        {
          command,
          args,
          inputPath,
          outputPath,
          timeoutMs,
          timedOut: true,
          terminationSignal,
          stdout: outChunks.join(""),
          stderr: errChunks.join(""),
        }
      );
      hooks?.onFinished?.({ executionStatus: result.execution_status, timedOut: true, terminationSignal });
      resolve(result);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      const result = makeResult(step, input, attempt, startedAt, "FAILED", err.message, {
        command,
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
        const result = makeResult(
          step,
          input,
          attempt,
          startedAt,
          "SUCCESS",
          "pi completed without a result envelope; using response text",
          { command, inputPath, outputPath, exitStatus, response: stdout.trim() }
        );
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
        const result = makeResult(step, input, attempt, startedAt, "FAILED", `Invalid Pi result envelope: ${(err as Error).message}`, {
          command,
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

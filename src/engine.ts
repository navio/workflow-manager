import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { EventLog } from "./events.js";
import { executeMockStep } from "./mockExecutor.js";
import { executeOpencodeStep, shouldUseRealOpencode } from "./opencodeExecutor.js";
import { executeClaudeCodeStep, shouldUseRealClaudeCode } from "./claudeCodeExecutor.js";
import type {
  InputEnvelope,
  OutputEnvelope,
  RunOptions,
  RunResult,
  StepDefinition,
  StepRun,
  ValidationMode,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "./types.js";

function nodeType(step: StepDefinition): "AGENT" | "HUMAN" | "SYSTEM" {
  if (step.kind === "approval") return "HUMAN";
  if (step.kind === "system") return "SYSTEM";
  return "AGENT";
}

function stepObjective(step: StepDefinition, workflowObjective: string): string {
  return step.objective ?? `${workflowObjective} :: ${step.key}`;
}

function requiresValidation(step: StepDefinition): ValidationMode {
  if (step.approvalSpec?.validation?.required) return step.approvalSpec.validation.mode ?? "human";
  if (step.validation?.required) return step.validation.mode ?? "human";
  if (step.kind === "approval") return step.approvalSpec?.validation?.mode ?? "human";
  return step.validation?.mode ?? "none";
}

function canConfirm(
  step: StepDefinition,
  options: RunOptions,
  output: OutputEnvelope
): { ok: boolean; reason?: string } {
  const mode = requiresValidation(step);
  if (mode === "none" && output.execution_status !== "YIELD_EXTERNAL") return { ok: true };

  if (options.autoConfirmAll) return { ok: true };
  const list = new Set(options.confirmations ?? []);
  const modeToken = `${step.key}:${mode}`;
  if (list.has(step.key) || list.has(modeToken)) return { ok: true };

  const autoConfirm = step.validation?.autoConfirm ?? step.approvalSpec?.validation?.autoConfirm ?? false;
  if (autoConfirm) return { ok: true };

  return { ok: false, reason: `Missing confirmation for ${step.key} (${mode})` };
}

function askConfirmation(stepKey: string, objective: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    process.stderr.write(`\n► ${stepKey}: ${objective}\n  Approve? [y/n]: `);
    rl.once("line", (answer) => {
      rl.close();
      process.stdin.resume();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

async function executeStep(step: StepDefinition, input: InputEnvelope, attempt: number): Promise<OutputEnvelope> {
  const adapterKey = step.taskSpec?.adapterKey ?? "mock";

  if (adapterKey === "opencode" && shouldUseRealOpencode(step)) {
    return executeOpencodeStep(step, input, attempt);
  }

  if (adapterKey === "claude-code" && shouldUseRealClaudeCode(step)) {
    return executeClaudeCodeStep(step, input, attempt);
  }

  return executeMockStep(step, input, attempt);
}

export async function runWorkflow(definition: WorkflowDefinition, options?: RunOptions): Promise<RunResult> {
  const runId = randomUUID();
  const actor = options?.actor ?? "cli";
  const primaryObjective = options?.objective ?? definition.title;
  const workflowObjectives = definition.objectives ?? [];
  const globalState: Record<string, unknown> = { ...(options?.input ?? {}) };
  const eventLog = new EventLog();

  let runStatus: WorkflowRunStatus = "queued";
  const stepRuns = new Map<string, StepRun>();

  for (const step of definition.steps) {
    stepRuns.set(step.key, {
      stepKey: step.key,
      status: "pending",
      attempt: 0,
      confirmed: false,
    });
  }

  eventLog.push(runId, "run.created", { workflowKey: definition.key }, undefined, actor);
  runStatus = "running";
  eventLog.push(runId, "run.started", { objective: primaryObjective, objectives: workflowObjectives }, undefined, actor);

  let index = 0;
  let guard = 0;
  const maxSteps = Math.max(definition.steps.length * 30, 30);

  while (index < definition.steps.length) {
    guard += 1;
    if (guard > maxSteps) {
      runStatus = "failed";
      eventLog.push(runId, "run.failed", { reason: "Execution guard exceeded" });
      break;
    }

    const step = definition.steps[index];
    const stepRun = stepRuns.get(step.key);
    if (!stepRun) throw new Error(`Missing step run for ${step.key}`);

    const dependencies = step.dependsOn ?? [];
    const depsComplete = dependencies.every((depKey) => stepRuns.get(depKey)?.status === "succeeded");
    if (!depsComplete) {
      runStatus = "failed";
      eventLog.push(runId, "run.failed", { reason: `Dependencies not satisfied for ${step.key}` }, step.key);
      break;
    }

    stepRun.status = "runnable";
    eventLog.push(runId, "step.runnable", { stepKey: step.key }, step.key);

    stepRun.status = "running";
    stepRun.attempt += 1;
    eventLog.push(runId, "step.claimed", { attempt: stepRun.attempt }, step.key);
    eventLog.push(runId, "step.execution_started", { attempt: stepRun.attempt }, step.key);

    const previousOutput: Record<string, unknown> = {};
    for (const dep of dependencies) {
      previousOutput[dep] = stepRuns.get(dep)?.output ?? null;
    }

    const inputEnvelope: InputEnvelope = {
      global_context: {
        workflow_id: runId,
        primary_objective: primaryObjective,
        workflow_objectives: workflowObjectives,
        global_state: globalState,
      },
      step_context: {
        step_id: step.key,
        step_objective: stepObjective(step, primaryObjective),
        previous_output: previousOutput,
        assigned_node_type: nodeType(step),
      },
      priming_configuration: {
        required_skills: step.taskSpec?.init?.skills ?? [],
        mcp_endpoints: step.taskSpec?.init?.mcps ?? [],
        system_prompts: step.taskSpec?.init?.systemPrompts ?? [],
        context: step.taskSpec?.init?.context,
        adapter: step.taskSpec?.adapterKey ?? "mock",
        model: step.taskSpec?.init?.model,
      },
    };

    const output: OutputEnvelope = await executeStep(step, inputEnvelope, stepRun.attempt);
    eventLog.push(
      runId,
      "step.execution_finished",
      {
        status: output.execution_status,
        action: output.qa_routing.action,
        adapter: step.taskSpec?.adapterKey ?? "mock",
        init: {
          skills: step.taskSpec?.init?.skills ?? [],
          mcps: step.taskSpec?.init?.mcps ?? [],
          context: step.taskSpec?.init?.context ?? {},
        },
      },
      step.key
    );

    let confirmed = canConfirm(step, options ?? {}, output).ok;
    if (!confirmed && options?.interactive && process.stdin.isTTY) {
      confirmed = await askConfirmation(step.key, stepObjective(step, primaryObjective));
    }
    if (!confirmed) {
      stepRun.status = "waiting_for_approval";
      runStatus = "waiting_for_approval";
      eventLog.push(
        runId,
        "step.waiting_for_approval",
        { reason: `confirmation required for ${step.key}`, validation: requiresValidation(step) },
        step.key
      );
      eventLog.push(runId, "run.waiting_for_approval", { reason: "confirmation required" }, step.key, actor);
      break;
    }

    stepRun.confirmed = true;
    eventLog.push(runId, "step.confirmed", { by: actor, validation: requiresValidation(step) }, step.key, actor);

    if (output.execution_status === "YIELD_EXTERNAL") {
      stepRun.status = "waiting_for_approval";
      runStatus = "waiting_for_approval";
      eventLog.push(runId, "step.waiting_for_approval", { reason: "external intervention" }, step.key);
      eventLog.push(runId, "approval.resolved", { decision: "approved" }, step.key, actor);
      stepRun.status = "succeeded";
      runStatus = "running";
      stepRun.output = output.mutated_payload;
      globalState[step.key] = output.mutated_payload;
      index += 1;
      continue;
    }

    if (output.execution_status === "FAILED") {
      stepRun.status = "failed";
      runStatus = "failed";
      eventLog.push(runId, "run.failed", { stepKey: step.key, reason: "step failed" }, step.key);
      break;
    }

    if (output.execution_status === "QA_REJECTED") {
      const retryMax = step.retryPolicy?.maxAttempts ?? definition.defaultRetryPolicy?.maxAttempts ?? 1;
      if (output.qa_routing.action === "RETRY_CURRENT") {
        if (stepRun.attempt < retryMax) {
          stepRun.status = "pending";
          eventLog.push(runId, "step.retried", { stepKey: step.key, attempt: stepRun.attempt + 1 }, step.key);
          continue;
        }
        stepRun.status = "failed";
        runStatus = "failed";
        eventLog.push(runId, "run.failed", { stepKey: step.key, reason: "max retry exceeded" }, step.key);
        break;
      }

      if (output.qa_routing.action === "ROLLBACK_PREVIOUS") {
        if (index === 0) {
          stepRun.status = "failed";
          runStatus = "failed";
          eventLog.push(runId, "run.failed", { stepKey: step.key, reason: "cannot rollback before first step" }, step.key);
          break;
        }
        const prevStep = definition.steps[index - 1];
        const prevRun = stepRuns.get(prevStep.key)!;
        prevRun.status = "pending";
        prevRun.confirmed = false;
        eventLog.push(runId, "step.retried", { stepKey: prevStep.key, via: step.key }, prevStep.key);
        stepRun.status = "pending";
        stepRun.confirmed = false;
        index -= 1;
        continue;
      }

      if (output.qa_routing.action === "RESTART_ALL") {
        for (const s of definition.steps) {
          const sr = stepRuns.get(s.key)!;
          sr.status = "pending";
          sr.attempt = 0;
          sr.confirmed = false;
          delete sr.output;
        }
        eventLog.push(runId, "step.retried", { mode: "restart_all", triggeredBy: step.key }, step.key);
        index = 0;
        continue;
      }
    }

    stepRun.status = "succeeded";
    stepRun.output = output.mutated_payload;
    globalState[step.key] = output.mutated_payload;
    index += 1;
  }

  if (runStatus === "running") {
    runStatus = "succeeded";
    eventLog.push(runId, "run.completed", { steps: definition.steps.length }, undefined, actor);
  }

  return {
    runId,
    status: runStatus,
    outputs: globalState,
    stepRuns: definition.steps.map((s) => stepRuns.get(s.key)!),
    events: eventLog.all(),
  };
}

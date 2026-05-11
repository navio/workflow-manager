import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { EventLog } from "./events.js";
import { executeClaudeCodeStep, shouldUseRealClaudeCode } from "./claudeCodeExecutor.js";
import { executeMockStep } from "./mockExecutor.js";
import { executeOpencodeStep, shouldUseRealOpencode } from "./opencodeExecutor.js";
import type {
  ApprovalDecisionPayload,
  ContextSummary,
  InputEnvelope,
  OutputEnvelope,
  RunEvent,
  RunOptions,
  RunResult,
  RunSnapshot,
  StepDefinition,
  StepDetailSnapshot,
  StepExecutionHooks,
  StepLastExecution,
  StepRun,
  ValidationMode,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "./types.js";

interface StepRuntimeMeta {
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  lastExecution: StepLastExecution;
}

function nodeType(step: StepDefinition): "AGENT" | "HUMAN" | "SYSTEM" {
  if (step.kind === "approval") return "HUMAN";
  if (step.kind === "system") return "SYSTEM";
  return "AGENT";
}

function stepAdapter(step: StepDefinition): StepDetailSnapshot["adapter"] {
  return step.taskSpec?.adapterKey ?? "approval";
}

function stepObjective(step: StepDefinition, workflowObjective: string): string {
  return step.objective ?? `${workflowObjective} :: ${step.key}`;
}

function summarizeContext(value: unknown): ContextSummary {
  if (typeof value === "string") {
    return { type: "string", length: value.length };
  }

  if (value && typeof value === "object") {
    return { type: "object", keys: Object.keys(value as Record<string, unknown>).sort() };
  }

  return { type: "none" };
}

function requiresValidation(step: StepDefinition): ValidationMode {
  if (step.approvalSpec?.validation?.required) return step.approvalSpec.validation.mode ?? "human";
  if (step.validation?.required) return step.validation.mode ?? "human";
  if (step.kind === "approval") return step.approvalSpec?.validation?.mode ?? "human";
  return step.validation?.mode ?? "none";
}

export function canUseInteractiveConfirmation(step: StepDefinition): boolean {
  return requiresValidation(step) === "human";
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

async function executeStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  workflow: WorkflowDefinition,
  workflowFilePath: string,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  const adapterKey = step.taskSpec?.adapterKey ?? "mock";

  if (adapterKey === "opencode" && shouldUseRealOpencode(step)) {
    return executeOpencodeStep(step, input, attempt, hooks);
  }

  if (adapterKey === "claude-code" && shouldUseRealClaudeCode(step)) {
    return executeClaudeCodeStep(step, input, attempt, workflow, workflowFilePath, hooks);
  }

  return executeMockStep(step, input, attempt, hooks);
}

export async function runWorkflow(definition: WorkflowDefinition, options?: RunOptions): Promise<RunResult> {
  const runId = options?.runId ?? randomUUID();
  const actor = options?.actor ?? "cli";
  const primaryObjective = options?.objective ?? definition.title;
  const workflowObjectives = definition.objectives ?? [];
  const globalState: Record<string, unknown> = { ...(options?.input ?? {}) };
  const workflowFilePath = options?.workflowFilePath ?? "";
  const eventLog = new EventLog();
  const observer = options?.observer;
  const controller = options?.controller;

  let runStatus: WorkflowRunStatus = "queued";
  let currentStepKey: string | null = null;
  let runStartedAt: string | null = null;
  let runUpdatedAt = new Date().toISOString();
  let runEndedAt: string | null = null;
  let waitingForApproval: RunSnapshot["waitingForApproval"] = null;

  const stepRuns = new Map<string, StepRun>();
  const stepRuntime = new Map<string, StepRuntimeMeta>();

  const emptyExecution = (): StepLastExecution => ({
    executionStatus: null,
    qaAction: null,
    feedbackReason: null,
  });

  const touchRun = (ended = false): void => {
    const now = new Date().toISOString();
    runUpdatedAt = now;
    if (ended) {
      runEndedAt = now;
    }
  };

  const touchStep = (
    stepKey: string,
    patch: Partial<Omit<StepRuntimeMeta, "lastExecution">> & { lastExecution?: StepLastExecution }
  ): void => {
    const current = stepRuntime.get(stepKey);
    if (!current) {
      return;
    }

    const now = new Date().toISOString();
    if (patch.startedAt !== undefined) current.startedAt = patch.startedAt;
    if (patch.finishedAt !== undefined) current.finishedAt = patch.finishedAt;
    if (patch.lastExecution) current.lastExecution = { ...patch.lastExecution };
    current.updatedAt = patch.updatedAt ?? now;
    touchRun(false);
  };

  const buildStepDetails = (): StepDetailSnapshot[] =>
    definition.steps.map((step) => {
      const run = stepRuns.get(step.key)!;
      const runtime = stepRuntime.get(step.key)!;
      return {
        stepKey: step.key,
        status: run.status,
        attempt: run.attempt,
        confirmed: run.confirmed,
        adapter: stepAdapter(step),
        startedAt: runtime.startedAt,
        updatedAt: runtime.updatedAt,
        finishedAt: runtime.finishedAt,
        kind: step.kind,
        objective: step.objective ?? step.title ?? null,
        dependsOn: step.dependsOn ?? [],
        config: {
          model: typeof step.taskSpec?.init?.model === "string" ? step.taskSpec.init.model : null,
          skills: step.taskSpec?.init?.skills ?? [],
          mcps: step.taskSpec?.init?.mcps ?? [],
          systemPrompts: step.taskSpec?.init?.systemPrompts ?? [],
          contextSummary: summarizeContext(step.taskSpec?.init?.context),
        },
        lastExecution: { ...runtime.lastExecution },
      };
    });

  const buildSnapshot = (): RunSnapshot => ({
    runId,
    workflowKey: definition.key,
    workflowTitle: definition.title,
    status: runStatus,
    currentStepKey,
    startedAt: runStartedAt,
    updatedAt: runUpdatedAt,
    endedAt: runEndedAt,
    objective: primaryObjective,
    objectives: [...workflowObjectives],
    waitingForApproval: waitingForApproval ? { ...waitingForApproval } : null,
    steps: definition.steps.map((step) => {
      const run = stepRuns.get(step.key)!;
      const runtime = stepRuntime.get(step.key)!;
      return {
        stepKey: step.key,
        status: run.status,
        attempt: run.attempt,
        confirmed: run.confirmed,
        adapter: stepAdapter(step),
        startedAt: runtime.startedAt,
        updatedAt: runtime.updatedAt,
        finishedAt: runtime.finishedAt,
      };
    }),
  });

  const emitSnapshot = (): void => {
    observer?.onSnapshot(buildSnapshot(), buildStepDetails());
  };

  const pushEvent = (
    type: RunEvent["type"],
    payload: Record<string, unknown> = {},
    stepKey?: string,
    eventActor = "system"
  ): void => {
    const event = eventLog.push(runId, type, payload, stepKey, eventActor);
    observer?.onEvent(event);
  };

  const emitLog = (stepKey: string, stream: "stdout" | "stderr", text: string): void => {
    observer?.onLog({
      id: randomUUID(),
      runId,
      stepKey,
      stream,
      text,
      occurredAt: new Date().toISOString(),
    });
  };

  const waitForDecision = async (
    step: StepDefinition,
    stepRun: StepRun,
    reason: string,
    validation: ValidationMode,
    requireConfirmationEvent: boolean
  ): Promise<ApprovalDecisionPayload | null> => {
    stepRun.status = "waiting_for_approval";
    runStatus = "waiting_for_approval";
    waitingForApproval = {
      stepKey: step.key,
      reason,
      validation,
    };
    touchStep(step.key, { finishedAt: null });
    pushEvent("step.waiting_for_approval", { reason, validation }, step.key);
    pushEvent("run.waiting_for_approval", { reason }, step.key, actor);
    emitSnapshot();

    if (!controller) {
      return null;
    }

    const resolution = await controller.waitForDecision({ stepKey: step.key, reason, validation });
    const resolutionActor = resolution.actor?.trim() ? resolution.actor : actor;
    pushEvent(
      "approval.resolved",
      {
        decision: resolution.decision,
        actor: resolutionActor,
        note: resolution.note ?? null,
        source: resolution.source ?? "api",
      },
      step.key,
      resolutionActor
    );

    if (resolution.decision === "cancelled") {
      stepRun.status = "cancelled";
      runStatus = "cancelled";
      currentStepKey = step.key;
      waitingForApproval = null;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      touchRun(true);
      pushEvent(
        "run.cancelled",
        { stepKey: step.key, reason: resolution.note ?? "cancelled by API", source: resolution.source ?? "api" },
        step.key,
        resolutionActor
      );
      emitSnapshot();
      return resolution;
    }

    waitingForApproval = null;
    runStatus = "running";
    if (requireConfirmationEvent) {
      stepRun.confirmed = true;
      pushEvent(
        "step.confirmed",
        { by: resolutionActor, validation, note: resolution.note ?? null, source: resolution.source ?? "api" },
        step.key,
        resolutionActor
      );
    }
    emitSnapshot();
    return resolution;
  };

  for (const step of definition.steps) {
    stepRuns.set(step.key, {
      stepKey: step.key,
      status: "pending",
      attempt: 0,
      confirmed: false,
    });
    stepRuntime.set(step.key, {
      startedAt: null,
      updatedAt: runUpdatedAt,
      finishedAt: null,
      lastExecution: emptyExecution(),
    });
  }

  emitSnapshot();
  pushEvent("run.created", { workflowKey: definition.key }, undefined, actor);

  runStatus = "running";
  runStartedAt = new Date().toISOString();
  touchRun(false);
  pushEvent("run.started", { objective: primaryObjective, objectives: workflowObjectives }, undefined, actor);
  emitSnapshot();

  let index = 0;
  let guard = 0;
  const maxSteps = Math.max(definition.steps.length * 30, 30);

  while (index < definition.steps.length) {
    guard += 1;
    if (guard > maxSteps) {
      runStatus = "failed";
      touchRun(true);
      pushEvent("run.failed", { reason: "Execution guard exceeded" });
      emitSnapshot();
      break;
    }

    const step = definition.steps[index];
    const stepRun = stepRuns.get(step.key);
    if (!stepRun) throw new Error(`Missing step run for ${step.key}`);

    const dependencies = step.dependsOn ?? [];
    const depsComplete = dependencies.every((depKey) => stepRuns.get(depKey)?.status === "succeeded");
    if (!depsComplete) {
      runStatus = "failed";
      currentStepKey = step.key;
      touchRun(true);
      pushEvent("run.failed", { reason: `Dependencies not satisfied for ${step.key}` }, step.key);
      emitSnapshot();
      break;
    }

    stepRun.status = "runnable";
    currentStepKey = step.key;
    waitingForApproval = null;
    touchStep(step.key, { finishedAt: null });
    pushEvent("step.runnable", { stepKey: step.key }, step.key);
    emitSnapshot();

    stepRun.status = "running";
    stepRun.attempt += 1;
    touchStep(step.key, { startedAt: new Date().toISOString(), finishedAt: null });
    pushEvent("step.claimed", { attempt: stepRun.attempt }, step.key);
    pushEvent("step.execution_started", { attempt: stepRun.attempt }, step.key);
    emitSnapshot();

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

    const hooks: StepExecutionHooks = {
      onStarted: (payload) => {
        pushEvent("agent.started", { attempt: stepRun.attempt, ...(payload ?? {}) }, step.key);
      },
      onStdout: (chunk) => {
        emitLog(step.key, "stdout", chunk);
        pushEvent("agent.stdout", { stream: "stdout", text: chunk }, step.key);
      },
      onStderr: (chunk) => {
        emitLog(step.key, "stderr", chunk);
        pushEvent("agent.stderr", { stream: "stderr", text: chunk }, step.key);
      },
      onFinished: (payload) => {
        pushEvent("agent.finished", { attempt: stepRun.attempt, ...(payload ?? {}) }, step.key);
      },
    };

    const output = await executeStep(step, inputEnvelope, stepRun.attempt, definition, workflowFilePath, hooks);
    touchStep(step.key, {
      lastExecution: {
        executionStatus: output.execution_status,
        qaAction: output.qa_routing.action,
        feedbackReason: output.qa_routing.feedback_reason,
      },
    });
    pushEvent(
      "step.execution_finished",
      {
        status: output.execution_status,
        action: output.qa_routing.action,
        feedbackReason: output.qa_routing.feedback_reason,
        adapter: step.taskSpec?.adapterKey ?? "mock",
        init: {
          skills: step.taskSpec?.init?.skills ?? [],
          mcps: step.taskSpec?.init?.mcps ?? [],
          context: step.taskSpec?.init?.context ?? {},
          systemPrompts: step.taskSpec?.init?.systemPrompts ?? [],
          model: step.taskSpec?.init?.model ?? null,
        },
      },
      step.key
    );
    emitSnapshot();

    let confirmed = canConfirm(step, options ?? {}, output).ok;
    if (!confirmed && options?.interactive && process.stdin.isTTY && canUseInteractiveConfirmation(step)) {
      confirmed = await askConfirmation(step.key, stepObjective(step, primaryObjective));
    }

    if (!confirmed) {
      const validation = requiresValidation(step);
      const decision = await waitForDecision(step, stepRun, `confirmation required for ${step.key}`, validation, true);
      if (decision === null || decision.decision === "cancelled") {
        break;
      }
    }

    if (!stepRun.confirmed) {
      stepRun.confirmed = true;
      waitingForApproval = null;
      pushEvent("step.confirmed", { by: actor, validation: requiresValidation(step) }, step.key, actor);
      emitSnapshot();
    }

    if (output.execution_status === "YIELD_EXTERNAL") {
      const decision = await waitForDecision(step, stepRun, "external intervention", "external", false);
      if (decision === null || decision.decision === "cancelled") {
        break;
      }
      stepRun.status = "succeeded";
      runStatus = "running";
      waitingForApproval = null;
      stepRun.output = output.mutated_payload;
      globalState[step.key] = output.mutated_payload;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      currentStepKey = null;
      emitSnapshot();
      index += 1;
      continue;
    }

    if (output.execution_status === "FAILED") {
      stepRun.status = "failed";
      runStatus = "failed";
      currentStepKey = step.key;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      touchRun(true);
      pushEvent("run.failed", { stepKey: step.key, reason: "step failed" }, step.key);
      emitSnapshot();
      break;
    }

    if (output.execution_status === "QA_REJECTED") {
      const retryMax = step.retryPolicy?.maxAttempts ?? definition.defaultRetryPolicy?.maxAttempts ?? 1;
      if (output.qa_routing.action === "RETRY_CURRENT") {
        if (stepRun.attempt < retryMax) {
          stepRun.status = "pending";
          touchStep(step.key, { finishedAt: new Date().toISOString() });
          pushEvent("step.retried", { stepKey: step.key, attempt: stepRun.attempt + 1 }, step.key);
          emitSnapshot();
          continue;
        }
        stepRun.status = "failed";
        runStatus = "failed";
        currentStepKey = step.key;
        touchStep(step.key, { finishedAt: new Date().toISOString() });
        touchRun(true);
        pushEvent("run.failed", { stepKey: step.key, reason: "max retry exceeded" }, step.key);
        emitSnapshot();
        break;
      }

      if (output.qa_routing.action === "ROLLBACK_PREVIOUS") {
        if (index === 0) {
          stepRun.status = "failed";
          runStatus = "failed";
          currentStepKey = step.key;
          touchStep(step.key, { finishedAt: new Date().toISOString() });
          touchRun(true);
          pushEvent("run.failed", { stepKey: step.key, reason: "cannot rollback before first step" }, step.key);
          emitSnapshot();
          break;
        }

        const prevStep = definition.steps[index - 1];
        const prevRun = stepRuns.get(prevStep.key)!;
        prevRun.status = "pending";
        prevRun.attempt = 0;
        prevRun.confirmed = false;
        touchStep(prevStep.key, { startedAt: null, finishedAt: null, lastExecution: emptyExecution() });
        pushEvent("step.retried", { stepKey: prevStep.key, via: step.key }, prevStep.key);
        stepRun.status = "pending";
        stepRun.confirmed = false;
        touchStep(step.key, { finishedAt: new Date().toISOString() });
        emitSnapshot();
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
          touchStep(s.key, { startedAt: null, finishedAt: null, lastExecution: emptyExecution() });
        }
        currentStepKey = null;
        pushEvent("step.retried", { mode: "restart_all", triggeredBy: step.key }, step.key);
        emitSnapshot();
        index = 0;
        continue;
      }

      stepRun.status = "failed";
      runStatus = "failed";
      currentStepKey = step.key;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      touchRun(true);
      pushEvent("run.failed", { stepKey: step.key, reason: `Unknown QA action: ${output.qa_routing.action}` }, step.key);
      emitSnapshot();
      break;
    }

    stepRun.status = "succeeded";
    stepRun.output = output.mutated_payload;
    globalState[step.key] = output.mutated_payload;
    touchStep(step.key, { finishedAt: new Date().toISOString() });
    currentStepKey = null;
    emitSnapshot();
    index += 1;
  }

  if (runStatus === "running") {
    runStatus = "succeeded";
    currentStepKey = null;
    touchRun(true);
    pushEvent("run.completed", { steps: definition.steps.length }, undefined, actor);
    emitSnapshot();
  }

  return {
    runId,
    status: runStatus,
    outputs: globalState,
    stepRuns: definition.steps.map((step) => stepRuns.get(step.key)!),
    events: eventLog.all(),
  };
}

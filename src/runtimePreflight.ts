import fs from "node:fs";
import path from "node:path";
import { resolveTaskAdapter } from "./adapters.js";
import { shouldUseRealClaudeCode } from "./claudeCodeExecutor.js";
import { shouldUseRealOpencode } from "./opencodeExecutor.js";
import { DEFAULT_PI_COMMAND } from "./piAgentExecutor.js";
import type { AdapterKey, StepDefinition, WorkflowDefinition } from "./types.js";

interface RuntimeRequirement {
  stepKey: string;
  adapter: AdapterKey;
  command?: string;
  envVars: string[];
}

export interface RuntimeDoctorCheck {
  key: string;
  label: string;
  status: "ok" | "missing" | "info";
  required: boolean;
  detail: string;
}

export interface AdapterImplementationStatus {
  adapter: AdapterKey;
  status: "real" | "mock" | "partial";
  detail: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return isExecutable(path.resolve(command));
  }

  const pathValue = env.PATH ?? "";
  const extensions =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    for (const extension of extensions) {
      if (isExecutable(path.join(directory, `${command}${extension}`))) {
        return true;
      }
    }
  }

  return false;
}

function piAgentCommand(step: StepDefinition, env: NodeJS.ProcessEnv): string {
  const payload = asRecord(step.taskSpec?.payload);
  if (typeof payload.command === "string" && payload.command.trim()) {
    return payload.command;
  }
  if (env.WFM_PI_AGENT_COMMAND?.trim()) {
    return env.WFM_PI_AGENT_COMMAND;
  }
  return DEFAULT_PI_COMMAND;
}

function requiredEnvFromModel(model: unknown): string | null {
  if (typeof model !== "string" || !model.trim()) {
    return null;
  }

  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("openrouter/")) {
    return "OPENROUTER_API_KEY";
  }
  if (normalized.startsWith("openai/") || normalized.startsWith("gpt-") || normalized.includes("/gpt-")) {
    return "OPENAI_API_KEY";
  }
  if (normalized.startsWith("anthropic/") || normalized.startsWith("claude-") || normalized.includes("/claude")) {
    return "ANTHROPIC_API_KEY";
  }

  return null;
}

function explicitRequiredEnv(step: StepDefinition): string[] {
  const payload = asRecord(step.taskSpec?.payload);
  const required = new Set<string>();

  if (Array.isArray(payload.requiredEnv)) {
    for (const value of payload.requiredEnv) {
      if (typeof value === "string" && value.trim()) {
        required.add(value.trim());
      }
    }
  }

  return [...required].sort();
}

function requiredEnvVars(step: StepDefinition): string[] {
  const payload = asRecord(step.taskSpec?.payload);
  const required = new Set<string>(explicitRequiredEnv(step));
  const fromInitModel = requiredEnvFromModel(step.taskSpec?.init?.model);
  const fromPayloadModel = requiredEnvFromModel(payload.model);
  if (fromInitModel) required.add(fromInitModel);
  if (fromPayloadModel) required.add(fromPayloadModel);

  return [...required].sort();
}

function runtimeRequirement(step: StepDefinition, env: NodeJS.ProcessEnv): RuntimeRequirement | null {
  if (step.kind !== "task") {
    return null;
  }

  const adapter = resolveTaskAdapter(step.taskSpec?.adapterKey);
  const envVars = requiredEnvVars(step);

  if (adapter === "pi-agent") {
    // pi manages provider credentials in its own auth store, so only
    // explicitly declared env vars are enforced for pi steps.
    return { stepKey: step.key, adapter, command: piAgentCommand(step, env), envVars: explicitRequiredEnv(step) };
  }

  if (adapter === "opencode" && shouldUseRealOpencode(step)) {
    return { stepKey: step.key, adapter, command: "opencode", envVars };
  }

  if (adapter === "claude-code" && shouldUseRealClaudeCode(step)) {
    return { stepKey: step.key, adapter, command: "claude", envVars };
  }

  if (envVars.length > 0 && adapter !== "mock") {
    return { stepKey: step.key, adapter, envVars };
  }

  return null;
}

export function validateRuntimeRequirements(
  definition: WorkflowDefinition,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const errors: string[] = [];

  for (const step of definition.steps) {
    const requirement = runtimeRequirement(step, env);
    if (!requirement) {
      continue;
    }

    if (requirement.command && !commandExists(requirement.command, env)) {
      errors.push(
        `Step ${requirement.stepKey} requires ${requirement.adapter} command "${requirement.command}", but it is not installed or not executable on this host`
      );
    }

    for (const envVar of requirement.envVars) {
      if (!env[envVar]?.trim()) {
        errors.push(`Step ${requirement.stepKey} requires ${envVar} for ${requirement.adapter} LLM access`);
      }
    }
  }

  return errors;
}

function commandCheck(
  key: string,
  label: string,
  command: string,
  required: boolean,
  env: NodeJS.ProcessEnv
): RuntimeDoctorCheck {
  const ok = commandExists(command, env);
  return {
    key,
    label,
    status: ok ? "ok" : "missing",
    required,
    detail: ok ? `${command} is executable` : `${command} is not installed or not executable on this host`,
  };
}

function envCheck(key: string, label: string, envVar: string, env: NodeJS.ProcessEnv): RuntimeDoctorCheck {
  const ok = !!env[envVar]?.trim();
  return {
    key,
    label,
    status: ok ? "ok" : "missing",
    required: false,
    detail: ok ? `${envVar} is set` : `${envVar} is not set`,
  };
}

export function runtimeDoctorChecks(env: NodeJS.ProcessEnv = process.env): RuntimeDoctorCheck[] {
  const piAgentStep: StepDefinition = { key: "pi-agent", kind: "task", taskSpec: {} };
  return [
    commandCheck("pi-agent", "Pi command", piAgentCommand(piAgentStep, env), true, env),
    commandCheck("opencode", "OpenCode command", "opencode", false, env),
    commandCheck("claude", "Claude Code command", "claude", false, env),
    envCheck("openrouter-key", "OpenRouter API key", "OPENROUTER_API_KEY", env),
    envCheck("openai-key", "OpenAI API key", "OPENAI_API_KEY", env),
    envCheck("anthropic-key", "Anthropic API key", "ANTHROPIC_API_KEY", env),
  ];
}

export function adapterImplementationStatuses(): AdapterImplementationStatus[] {
  return [
    {
      adapter: "pi-agent",
      status: "real",
      detail: "default host-backed adapter driving the pi coding agent CLI",
    },
    {
      adapter: "mock",
      status: "mock",
      detail: "deterministic in-process simulator for tests and local authoring",
    },
    {
      adapter: "opencode",
      status: "partial",
      detail: "mock-routed by default; real host smoke path only when useRealAdapter and opencodeSmokeTest are true",
    },
    {
      adapter: "codex",
      status: "mock",
      detail: "currently mock-routed; real Codex executor is not implemented yet",
    },
    {
      adapter: "claude-code",
      status: "partial",
      detail: "mock-routed by default; real host CLI path only when useRealAdapter is true",
    },
  ];
}

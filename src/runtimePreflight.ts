import fs from "node:fs";
import path from "node:path";
import { resolveTaskAdapter } from "./adapters.js";
import { shouldUseRealClaudeCode } from "./claudeCodeExecutor.js";
import { shouldUseRealOpencode } from "./opencodeExecutor.js";
import type { AdapterKey, StepDefinition, WorkflowDefinition } from "./types.js";

interface RuntimeRequirement {
  stepKey: string;
  adapter: AdapterKey;
  command?: string;
  envVars: string[];
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
  return "pi-agent";
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

function requiredEnvVars(step: StepDefinition): string[] {
  const payload = asRecord(step.taskSpec?.payload);
  const required = new Set<string>();
  const fromInitModel = requiredEnvFromModel(step.taskSpec?.init?.model);
  const fromPayloadModel = requiredEnvFromModel(payload.model);
  if (fromInitModel) required.add(fromInitModel);
  if (fromPayloadModel) required.add(fromPayloadModel);

  if (Array.isArray(payload.requiredEnv)) {
    for (const value of payload.requiredEnv) {
      if (typeof value === "string" && value.trim()) {
        required.add(value.trim());
      }
    }
  }

  return [...required].sort();
}

function runtimeRequirement(step: StepDefinition, env: NodeJS.ProcessEnv): RuntimeRequirement | null {
  if (step.kind !== "task") {
    return null;
  }

  const adapter = resolveTaskAdapter(step.taskSpec?.adapterKey);
  const envVars = requiredEnvVars(step);

  if (adapter === "pi-agent") {
    return { stepKey: step.key, adapter, command: piAgentCommand(step, env), envVars };
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

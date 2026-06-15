import fs from "node:fs";
import path from "node:path";
import { resolveAcpCommand, shouldUseRealAcp } from "./acpExecutor.js";
import { resolveTaskAdapter } from "./adapters.js";
import { shouldUseRealClaudeCode } from "./claudeCodeExecutor.js";
import { shouldUseRealOpencode } from "./opencodeExecutor.js";
import { DEFAULT_PI_COMMAND } from "./piAgentExecutor.js";
import type { AdapterKey, StepDefinition, WorkflowDefinition } from "./types.js";

const ACP_ROUTABLE_ADAPTERS = new Set<AdapterKey>(["acp", "claude-code", "opencode", "codex"]);

function legacyExecutorEnabled(step: StepDefinition): boolean {
  return asRecord(step.taskSpec?.payload).legacyExecutor === true;
}

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

  const legacy = legacyExecutorEnabled(step);
  if (legacy && adapter === "opencode" && shouldUseRealOpencode(step)) {
    return { stepKey: step.key, adapter, command: "opencode", envVars };
  }

  if (legacy && adapter === "claude-code" && shouldUseRealClaudeCode(step)) {
    return { stepKey: step.key, adapter, command: "claude", envVars };
  }

  if (shouldUseRealAcp(step)) {
    // ACP agents manage their own credentials (like pi), so only explicitly declared
    // env vars are enforced; the resolved agent command must exist on the host.
    return {
      stepKey: step.key,
      adapter,
      command: resolveAcpCommand(step, env)?.command,
      envVars: explicitRequiredEnv(step),
    };
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
  const acpCommand = env.WFM_ACP_COMMAND?.trim();
  const acpCheck: RuntimeDoctorCheck = acpCommand
    ? commandCheck("acp", "ACP agent command", acpCommand, false, env)
    : {
        key: "acp",
        label: "ACP agent command",
        status: "info",
        required: false,
        detail: "configured per step (payload.acpCommand / acpAgent) or via WFM_ACP_COMMAND",
      };
  return [
    commandCheck("pi-agent", "Pi command", piAgentCommand(piAgentStep, env), true, env),
    acpCheck,
    commandCheck("opencode", "OpenCode command (legacy)", "opencode", false, env),
    commandCheck("claude", "Claude Code command (legacy)", "claude", false, env),
    envCheck("openrouter-key", "OpenRouter API key", "OPENROUTER_API_KEY", env),
    envCheck("openai-key", "OpenAI API key", "OPENAI_API_KEY", env),
    envCheck("anthropic-key", "Anthropic API key", "ANTHROPIC_API_KEY", env),
  ];
}

export interface AdapterMockFallbackWarning {
  stepKey: string;
  adapter: AdapterKey;
  message: string;
}

/**
 * Detects a step that explicitly selects a non-pi adapter whose real execution
 * path is not enabled, so the engine will route it to the mock executor. Non-pi
 * agents run through ACP, which needs `useRealAdapter: true` plus a resolvable
 * agent command. Returns a message explaining the gap, or null when the step
 * will run as the user expects (default pi-agent, an enabled ACP/legacy path, or
 * an intentional mock selection).
 */
export function adapterMockFallbackReason(step: StepDefinition): string | null {
  if (step.kind !== "task" || !step.taskSpec?.adapterKey) {
    return null;
  }

  const adapter = resolveTaskAdapter(step.taskSpec.adapterKey);
  if (!ACP_ROUTABLE_ADAPTERS.has(adapter)) {
    return null;
  }

  const legacy = legacyExecutorEnabled(step);
  if (legacy && adapter === "opencode" && shouldUseRealOpencode(step)) {
    return null;
  }
  if (legacy && adapter === "claude-code" && shouldUseRealClaudeCode(step)) {
    return null;
  }
  if (shouldUseRealAcp(step)) {
    return null;
  }

  if (asRecord(step.taskSpec?.payload).useRealAdapter === true) {
    // The user opted into a real run but no ACP agent command could be resolved.
    return `adapterKey '${adapter}' has useRealAdapter set, but no ACP agent command could be resolved, so the step runs as a mock. Set taskSpec.payload.acpCommand or acpAgent (or WFM_ACP_COMMAND) to run it through ACP.`;
  }

  if (resolveAcpCommand(step, process.env) !== null) {
    // A concrete agent is named (a preset like claude-code/opencode, or an explicit
    // command) but useRealAdapter is off, so the step still mocks.
    return `adapterKey '${adapter}' is set, but useRealAdapter is not enabled, so the step runs as a mock. Set taskSpec.payload.useRealAdapter: true to run it through ACP.`;
  }

  // Bare acp/codex with no agent configured is treated as an intentional mock.
  return null;
}

export function adapterMockFallbackWarnings(definition: WorkflowDefinition): AdapterMockFallbackWarning[] {
  const warnings: AdapterMockFallbackWarning[] = [];
  for (const step of definition.steps) {
    const message = adapterMockFallbackReason(step);
    if (message) {
      warnings.push({ stepKey: step.key, adapter: resolveTaskAdapter(step.taskSpec?.adapterKey), message });
    }
  }
  return warnings;
}

export function adapterImplementationStatuses(): AdapterImplementationStatus[] {
  return [
    {
      adapter: "pi-agent",
      status: "real",
      detail: "default host-backed adapter driving the pi coding agent CLI",
    },
    {
      adapter: "acp",
      status: "real",
      detail: "Agent Client Protocol adapter; runs any ACP agent (via acpCommand/acpAgent) when useRealAdapter is true",
    },
    {
      adapter: "mock",
      status: "mock",
      detail: "deterministic in-process simulator for tests and local authoring",
    },
    {
      adapter: "opencode",
      status: "partial",
      detail: "routed through ACP when useRealAdapter is true; bespoke executor deprecated (payload.legacyExecutor)",
    },
    {
      adapter: "codex",
      status: "partial",
      detail: "routed through ACP when useRealAdapter and an acpCommand/acpAgent are set; otherwise mock",
    },
    {
      adapter: "claude-code",
      status: "partial",
      detail: "routed through ACP when useRealAdapter is true; bespoke executor deprecated (payload.legacyExecutor)",
    },
  ];
}

import type { AdapterKey, StepDefinition } from "./types.js";

export const DEFAULT_TASK_ADAPTER: AdapterKey = "pi-agent";

export const SUPPORTED_ADAPTERS: readonly AdapterKey[] = [
  "pi-agent",
  "mock",
  "opencode",
  "codex",
  "claude-code",
  "kimi",
  "acp",
] as const;

export function resolveTaskAdapter(adapter?: AdapterKey): AdapterKey {
  return adapter ?? DEFAULT_TASK_ADAPTER;
}

/**
 * Resolves the adapter and payload the engine will use for a step's agent validator
 * (validation.mode "agent"), or null when the step has no agent validator.
 * The validator inherits the step's adapter when validation.agent.adapterKey is not
 * set, and inherits an explicit useRealAdapter: false opt-out from the step payload
 * unless the validator payload sets its own useRealAdapter — so a step opted out to
 * mock never silently spawns a real agent to validate itself.
 */
export function resolveValidatorAgentSpec(
  step: StepDefinition
): { adapterKey: AdapterKey; payload: Record<string, unknown> } | null {
  if (step.validation?.mode !== "agent") {
    return null;
  }
  const agentSpec = step.validation.agent ?? {};
  const adapterKey = agentSpec.adapterKey ?? resolveTaskAdapter(step.taskSpec?.adapterKey);
  const payload: Record<string, unknown> = { ...(agentSpec.payload ?? {}) };
  const stepPayload = step.taskSpec?.payload;
  if (
    !("useRealAdapter" in payload) &&
    stepPayload !== null &&
    typeof stepPayload === "object" &&
    (stepPayload as Record<string, unknown>).useRealAdapter === false
  ) {
    payload.useRealAdapter = false;
  }
  return { adapterKey, payload };
}

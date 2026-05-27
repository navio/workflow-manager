import type { AdapterKey } from "./types.js";

export const DEFAULT_TASK_ADAPTER: AdapterKey = "pi-agent";

export const SUPPORTED_ADAPTERS: readonly AdapterKey[] = [
  "pi-agent",
  "mock",
  "opencode",
  "codex",
  "claude-code",
] as const;

export function resolveTaskAdapter(adapter?: AdapterKey): AdapterKey {
  return adapter ?? DEFAULT_TASK_ADAPTER;
}

export interface RunnerUiBootstrap {
  runId: string;
  token: string;
}

export interface RunnerUiStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
}

export const RUNNER_UI_BOOTSTRAP_KEY = "workflow-manager.runner-ui.bootstrap";

function parseBootstrapParams(params: URLSearchParams): RunnerUiBootstrap | null {
  const runId = params.get("runId")?.trim();
  const token = params.get("token")?.trim();
  if (!runId || !token) {
    return null;
  }

  return { runId, token };
}

export function parseBootstrapFragment(fragment: string): RunnerUiBootstrap | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!raw.trim()) {
    return null;
  }

  try {
    return parseBootstrapParams(new URLSearchParams(raw));
  } catch {
    return null;
  }
}

export function readBootstrapFromLocation(locationLike: Pick<Location, "hash">): RunnerUiBootstrap | null {
  return parseBootstrapFragment(locationLike.hash);
}

export function loadBootstrap(storage: RunnerUiStorage): RunnerUiBootstrap | null {
  const raw = storage.getItem(RUNNER_UI_BOOTSTRAP_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const runId = typeof record.runId === "string" ? record.runId.trim() : "";
    const token = typeof record.token === "string" ? record.token.trim() : "";
    if (!runId || !token) {
      return null;
    }

    return { runId, token };
  } catch {
    return null;
  }
}

export function persistBootstrap(storage: RunnerUiStorage, bootstrap: RunnerUiBootstrap): void {
  storage.setItem(RUNNER_UI_BOOTSTRAP_KEY, JSON.stringify(bootstrap));
}

export function clearBootstrap(storage: RunnerUiStorage): void {
  storage.removeItem(RUNNER_UI_BOOTSTRAP_KEY);
}

export function resolveBootstrap(locationLike: Pick<Location, "hash">, storage: RunnerUiStorage): RunnerUiBootstrap | null {
  const fromFragment = readBootstrapFromLocation(locationLike);
  if (fromFragment) {
    persistBootstrap(storage, fromFragment);
    return fromFragment;
  }

  return loadBootstrap(storage);
}

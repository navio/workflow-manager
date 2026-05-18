import { describe, expect, test } from "bun:test";
import { clearBootstrap, loadBootstrap, parseBootstrapFragment, persistBootstrap, resolveBootstrap, RUNNER_UI_BOOTSTRAP_KEY, type RunnerUiBootstrap, type RunnerUiStorage } from "../src/lib/bootstrap";

function createStorage(seed?: Record<string, string>): RunnerUiStorage {
  const values = new Map(Object.entries(seed ?? {}));
  return {
    get length() {
      return values.size;
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
  } satisfies RunnerUiStorage;
}

describe("runner UI bootstrap", () => {
  test("parses the URL fragment", () => {
    expect(parseBootstrapFragment("#runId=run_123&token=secret")).toEqual({ runId: "run_123", token: "secret" });
    expect(parseBootstrapFragment("#token=secret")).toBeNull();
    expect(parseBootstrapFragment("#runId=run_123")).toBeNull();
    expect(parseBootstrapFragment("")).toBeNull();
  });

  test("stores bootstrap only in session storage", () => {
    const storage = createStorage();
    const bootstrap: RunnerUiBootstrap = { runId: "run_1", token: "token_1" };

    persistBootstrap(storage, bootstrap);
    expect(storage.getItem(RUNNER_UI_BOOTSTRAP_KEY)).toBe(JSON.stringify(bootstrap));
    expect(loadBootstrap(storage)).toEqual(bootstrap);

    clearBootstrap(storage);
    expect(storage.getItem(RUNNER_UI_BOOTSTRAP_KEY)).toBeNull();
  });

  test("falls back to the stored session when the fragment is missing", () => {
    const storage = createStorage({ [RUNNER_UI_BOOTSTRAP_KEY]: JSON.stringify({ runId: "run_1", token: "token_1" }) });

    expect(resolveBootstrap({ hash: "" } as Location, storage)).toEqual({ runId: "run_1", token: "token_1" });
  });
});

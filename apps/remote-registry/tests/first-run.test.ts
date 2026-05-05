import { describe, expect, it } from "bun:test";
import { FIRST_RUN_DISMISSED_KEY, readFirstRunDismissed, writeFirstRunDismissed } from "../src/lib/firstRun";

interface FakeStorage {
  values: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function createStorage(seed: Record<string, string> = {}): FakeStorage {
  const values = { ...seed };
  return {
    values,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = value;
    },
    removeItem(key) {
      delete values[key];
    },
  };
}

describe("first run storage", () => {
  it("reads and writes dismissed state", () => {
    const storage = createStorage();

    expect(readFirstRunDismissed(storage)).toBe(false);

    writeFirstRunDismissed(storage, true);
    expect(storage.values[FIRST_RUN_DISMISSED_KEY]).toBe("1");
    expect(readFirstRunDismissed(storage)).toBe(true);

    writeFirstRunDismissed(storage, false);
    expect(storage.values[FIRST_RUN_DISMISSED_KEY]).toBeUndefined();
    expect(readFirstRunDismissed(storage)).toBe(false);
  });
});

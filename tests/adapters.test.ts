import { describe, expect, it } from "bun:test";
import { DEFAULT_TASK_ADAPTER, resolveTaskAdapter, resolveValidatorAgentSpec } from "../src/adapters.ts";
import type { StepDefinition } from "../src/types.ts";

describe("resolveTaskAdapter", () => {
  it("falls back to the default task adapter when unset", () => {
    expect(resolveTaskAdapter(undefined)).toBe(DEFAULT_TASK_ADAPTER);
  });

  it("returns the given adapter when set", () => {
    expect(resolveTaskAdapter("opencode")).toBe("opencode");
  });
});

describe("resolveValidatorAgentSpec", () => {
  it("returns null when the step has no agent validator", () => {
    const step: StepDefinition = { key: "s1", kind: "task", taskSpec: { adapterKey: "opencode" } };
    expect(resolveValidatorAgentSpec(step)).toBeNull();
  });

  it("returns null when validation.mode is set but not 'agent'", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode" },
      validation: { mode: "human" },
    };
    expect(resolveValidatorAgentSpec(step)).toBeNull();
  });

  it("inherits the step's adapter when validation.agent.adapterKey is not set", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode" },
      validation: { mode: "agent" },
    };
    expect(resolveValidatorAgentSpec(step)?.adapterKey).toBe("opencode");
  });

  it("prefers an explicit validation.agent.adapterKey over the step's adapter", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode" },
      validation: { mode: "agent", agent: { adapterKey: "claude-code" } },
    };
    expect(resolveValidatorAgentSpec(step)?.adapterKey).toBe("claude-code");
  });

  it("falls back to the default task adapter when neither the step nor the validator set one", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      validation: { mode: "agent" },
    };
    expect(resolveValidatorAgentSpec(step)?.adapterKey).toBe(DEFAULT_TASK_ADAPTER);
  });

  it("inherits the step's useRealAdapter: false opt-out into the validator payload", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode", payload: { useRealAdapter: false, mockResult: "success" } },
      validation: { mode: "agent" },
    };
    expect(resolveValidatorAgentSpec(step)?.payload).toEqual({ useRealAdapter: false });
  });

  it("does not inherit a step's useRealAdapter: true opt-in into the validator payload", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "claude-code", payload: { useRealAdapter: true } },
      validation: { mode: "agent" },
    };
    expect(resolveValidatorAgentSpec(step)?.payload).toEqual({});
  });

  it("lets the validator's own useRealAdapter setting win over the step's opt-out", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode", payload: { useRealAdapter: false } },
      validation: { mode: "agent", agent: { payload: { useRealAdapter: true } } },
    };
    expect(resolveValidatorAgentSpec(step)?.payload).toEqual({ useRealAdapter: true });
  });

  it("preserves other validator payload fields alongside the inherited opt-out", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode", payload: { useRealAdapter: false } },
      validation: { mode: "agent", agent: { payload: { mockResult: "success" } } },
    };
    expect(resolveValidatorAgentSpec(step)?.payload).toEqual({ mockResult: "success", useRealAdapter: false });
  });

  it("does not inherit the opt-out when the step's payload is not an object", () => {
    const step: StepDefinition = {
      key: "s1",
      kind: "task",
      taskSpec: { adapterKey: "opencode" },
      validation: { mode: "agent" },
    };
    expect(resolveValidatorAgentSpec(step)?.payload).toEqual({});
  });
});

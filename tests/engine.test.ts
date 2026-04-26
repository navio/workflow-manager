import { describe, expect, it } from "bun:test";
import { runWorkflow } from "../src/engine.ts";
import type { WorkflowDefinition } from "../src/types.ts";

describe("engine routing", () => {
  it("retries current step and succeeds", async () => {
    let flips = 0;
    const wf: WorkflowDefinition = {
      key: "retry-wf",
      title: "retry-wf",
      defaultRetryPolicy: { maxAttempts: 2 },
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          retryPolicy: { maxAttempts: 2 },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              get mockResult() {
                return flips++ === 0 ? "retry" : "success";
              },
            } as unknown as Record<string, unknown>,
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });
    expect(result.status).toBe("succeeded");
    expect(result.events.some((e) => e.type === "step.retried")).toBe(true);
  });

  it("rolls back previous and then succeeds", async () => {
    let second = 0;
    const wf: WorkflowDefinition = {
      key: "rollback-wf",
      title: "rollback-wf",
      defaultRetryPolicy: { maxAttempts: 2 },
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          retryPolicy: { maxAttempts: 2 },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
        {
          key: "s2",
          kind: "task",
          dependsOn: ["s1"],
          validation: { mode: "none", required: false, autoConfirm: true },
          retryPolicy: { maxAttempts: 2 },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              get mockResult() {
                return second++ === 0 ? "rollback" : "success";
              },
            } as unknown as Record<string, unknown>,
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });
    expect(result.status).toBe("succeeded");
    const retried = result.events.filter((e) => e.type === "step.retried");
    expect(retried.length).toBeGreaterThan(0);
  });

  it("waits for confirmation when step requires human validation", async () => {
    const wf: WorkflowDefinition = {
      key: "confirm-wf",
      title: "confirm-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "human", required: true, autoConfirm: false },
          taskSpec: { adapterKey: "opencode", payload: { mockResult: "success" } },
        },
      ],
    } as WorkflowDefinition;

    const result = await runWorkflow(wf);
    expect(result.status).toBe("waiting_for_approval");
    expect(result.events.some((e) => e.type === "step.waiting_for_approval")).toBe(true);
    expect(result.events.some((e) => e.type === "run.waiting_for_approval")).toBe(true);
    expect(result.events.some((e) => e.type === "run.cancelled")).toBe(false);
  });
});

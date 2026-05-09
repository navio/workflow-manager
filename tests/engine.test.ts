import { describe, expect, it } from "bun:test";
import { canUseInteractiveConfirmation, runWorkflow } from "../src/engine.ts";
import type { RunSnapshot, WorkflowDefinition } from "../src/types.ts";

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

  it("includes approval preview details while waiting for human validation", async () => {
    let waitingSnapshot: RunSnapshot | null = null;
    const snapshots: RunSnapshot[] = [];
    const wf: WorkflowDefinition = {
      key: "preview-wf",
      title: "preview-wf",
      steps: [
        {
          key: "draft",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success", output: "Draft spec ready" } },
        },
        {
          key: "review",
          kind: "task",
          dependsOn: ["draft"],
          objective: "Review the draft",
          validation: { mode: "human", required: true, autoConfirm: false },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success", summary: "Ready for sign-off" } },
        },
      ],
    };

    const result = await runWorkflow(wf, {
      observer: {
        onEvent() {},
        onLog() {},
        onSnapshot(snapshot) {
          snapshots.push(snapshot);
        },
      },
    });

    waitingSnapshot = snapshots.find((snapshot) => snapshot.status === "waiting_for_approval") ?? null;
    expect(result.status).toBe("waiting_for_approval");
    expect(waitingSnapshot?.waitingForApproval?.preview?.summary).toContain("Approve the results of review");
    expect(waitingSnapshot?.waitingForApproval?.preview?.items.some((item) => item.stepKey === "draft")).toBe(true);
    expect(waitingSnapshot?.waitingForApproval?.preview?.items.some((item) => item.stepKey === "review")).toBe(true);
  });

  it("uses approvalPrompt to approve human validation and continue", async () => {
    const wf: WorkflowDefinition = {
      key: "prompt-wf",
      title: "prompt-wf",
      steps: [
        {
          key: "review",
          kind: "task",
          objective: "Review the plan",
          validation: { mode: "human", required: true, autoConfirm: false },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success", summary: "Plan looks good" } },
        },
      ],
    };

    const result = await runWorkflow(wf, {
      approvalPrompt: async (request) => {
        expect(request.preview?.summary).toContain("Approve the results of review");
        return { decision: "approved", actor: "terminal-tester", source: "test" };
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "approval.resolved")).toBe(true);
    expect(result.events.some((event) => event.type === "step.confirmed")).toBe(true);
  });

  it("uses approvalPrompt to resume external validation and continue", async () => {
    const wf: WorkflowDefinition = {
      key: "external-prompt-wf",
      title: "external-prompt-wf",
      steps: [
        {
          key: "deploy",
          kind: "task",
          objective: "Deploy after external checks",
          validation: { mode: "external", required: true, autoConfirm: false },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success", summary: "Deployment bundle ready" } },
        },
      ],
    };

    const result = await runWorkflow(wf, {
      approvalPrompt: async (request) => {
        expect(request.validation).toBe("external");
        expect(request.preview?.summary).toContain("Approve the results of deploy");
        return { decision: "approved", actor: "terminal-tester", source: "test" };
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "approval.resolved")).toBe(true);
    expect(result.events.some((event) => event.type === "step.confirmed")).toBe(true);
  });

  it("treats approval steps as completed after human approval", async () => {
    const wf: WorkflowDefinition = {
      key: "approval-step-wf",
      title: "approval-step-wf",
      steps: [
        {
          key: "draft",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success", summary: "Draft ready" } },
        },
        {
          key: "qa_gate",
          kind: "approval",
          dependsOn: ["draft"],
          objective: "Approve the draft",
          approvalSpec: {
            autoApprove: false,
            validation: { mode: "human", required: true, autoConfirm: false },
          },
        },
      ],
    };

    const result = await runWorkflow(wf, {
      approvalPrompt: async (request) => {
        expect(request.stepKey).toBe("qa_gate");
        expect(request.preview?.items.some((item) => item.stepKey === "draft")).toBe(true);
        return { decision: "approved", actor: "terminal-tester", source: "test" };
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.stepRuns.find((step) => step.stepKey === "qa_gate")?.status).toBe("succeeded");
  });

  it("only allows interactive confirmation for human validation", () => {
    expect(
      canUseInteractiveConfirmation({
        key: "human-step",
        kind: "task",
        validation: { mode: "human", required: true, autoConfirm: false },
      })
    ).toBe(true);

    expect(
      canUseInteractiveConfirmation({
        key: "external-step",
        kind: "task",
        validation: { mode: "external", required: true, autoConfirm: false },
      })
    ).toBe(false);
  });
});

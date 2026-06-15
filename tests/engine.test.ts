import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canUseInteractiveConfirmation, runWorkflow } from "../src/engine.ts";
import type { RunSnapshot, WorkflowDefinition } from "../src/types.ts";
import { fakePiAgentScript } from "./helpers/piAgentFake.ts";

const ACP_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.ts");

describe("engine routing", () => {
  it("routes omitted task adapters through pi-agent by default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-engine-pi-agent-"));
    const script = fakePiAgentScript(dir);
    const wf: WorkflowDefinition = {
      key: "default-pi-wf",
      title: "Default PI WF",
      steps: [
        {
          key: "implement",
          kind: "task",
          objective: "Implement feature",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            init: {
              skills: ["test-driven-development"],
              mcps: ["filesystem"],
              systemPrompts: ["Use TDD"],
              context: { repo: "workflow-manager" },
            },
            payload: { command: process.execPath, args: [script], runDir: dir, timeoutMs: 5000 },
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    expect(result.outputs.implement).toMatchObject({
      adapter: "pi-agent",
      sawSkills: ["test-driven-development"],
      sawMcps: ["filesystem"],
    });
    expect(
      result.events.some(
        (event) => event.type === "step.execution_finished" && event.payload.adapter === "pi-agent"
      )
    ).toBe(true);
  });

  it("fails before starting when the default PI Agent command is missing", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const wf: WorkflowDefinition = {
        key: "missing-pi-agent-wf",
        title: "Missing PI Agent WF",
        steps: [
          {
            key: "implement",
            kind: "task",
            validation: { mode: "none", required: false, autoConfirm: true },
            taskSpec: {},
          },
        ],
      };

      const result = await runWorkflow(wf, { autoConfirmAll: true });

      expect(result.status).toBe("failed");
      expect(result.events.some((event) => event.type === "run.started")).toBe(false);
      expect(result.events.find((event) => event.type === "run.failed")?.payload.reason).toContain(
        "requires pi-agent command"
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

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

  it("resets previous step attempts when rolling back", async () => {
    let first = 0;
    let second = 0;
    const wf: WorkflowDefinition = {
      key: "rollback-attempt-wf",
      title: "rollback-attempt-wf",
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
                first += 1;
                return first === 2 ? "retry" : "success";
              },
            } as unknown as Record<string, unknown>,
          },
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
    expect(result.stepRuns.find((step) => step.stepKey === "s1")?.attempt).toBe(2);
  });

  it("runs dependencies before dependents even when declared later", async () => {
    const wf: WorkflowDefinition = {
      key: "dependency-order-wf",
      title: "dependency-order-wf",
      steps: [
        {
          key: "review",
          kind: "task",
          dependsOn: ["draft"],
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
        {
          key: "draft",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });
    const claimedSteps = result.events
      .filter((event) => event.type === "step.claimed")
      .map((event) => event.stepRunId);

    expect(result.status).toBe("succeeded");
    expect(claimedSteps).toEqual(["draft", "review"]);
  });

  it("returns a failed run result for circular dependencies", async () => {
    const wf: WorkflowDefinition = {
      key: "cycle-wf",
      title: "cycle-wf",
      steps: [
        {
          key: "first",
          kind: "task",
          dependsOn: ["second"],
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
        {
          key: "second",
          kind: "task",
          dependsOn: ["first"],
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    expect(result.events.find((event) => event.type === "run.failed")?.payload.reason).toContain(
      "Circular dependency detected"
    );
  });

  it("does not return stale outputs when rollback reruns a previous step that fails", async () => {
    let firstStepAttempts = 0;
    let secondStepAttempts = 0;
    const wf: WorkflowDefinition = {
      key: "rollback-stale-output-wf",
      title: "rollback-stale-output-wf",
      steps: [
        {
          key: "build",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              get mockResult() {
                return firstStepAttempts++ === 0 ? "success" : "fail";
              },
            } as unknown as Record<string, unknown>,
          },
        },
        {
          key: "verify",
          kind: "task",
          dependsOn: ["build"],
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              get mockResult() {
                return secondStepAttempts++ === 0 ? "rollback" : "success";
              },
            } as unknown as Record<string, unknown>,
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    expect(result.outputs.build).toBeUndefined();
  });

  it("does not return stale outputs when restart reruns a step that fails", async () => {
    let firstStepAttempts = 0;
    let secondStepAttempts = 0;
    const wf: WorkflowDefinition = {
      key: "restart-stale-output-wf",
      title: "restart-stale-output-wf",
      steps: [
        {
          key: "build",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              get mockResult() {
                return firstStepAttempts++ === 0 ? "success" : "fail";
              },
            } as unknown as Record<string, unknown>,
          },
        },
        {
          key: "verify",
          kind: "task",
          dependsOn: ["build"],
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              get mockResult() {
                return secondStepAttempts++ === 0 ? "restart" : "success";
              },
            } as unknown as Record<string, unknown>,
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    expect(result.outputs.build).toBeUndefined();
  });

  it("fails when a PI Agent client returns an unknown execution status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-engine-invalid-status-"));
    const script = path.join(dir, "invalid-status.mjs");
    fs.writeFileSync(
      script,
      `import fs from "node:fs";\nfs.writeFileSync(process.env.WFM_PI_OUTPUT_FILE, JSON.stringify({ step_id: "implement", execution_status: "DONE", qa_routing: { action: "PROCEED", feedback_reason: "" }, mutated_payload: { unsafe: true }, metadata: { execution_time_ms: 1, external_intervention_required: false } }));\n`,
      "utf-8"
    );
    const wf: WorkflowDefinition = {
      key: "invalid-status-wf",
      title: "invalid-status-wf",
      steps: [
        {
          key: "implement",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { payload: { command: process.execPath, args: [script], runDir: dir, timeoutMs: 5000 } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    expect(result.outputs.implement).toBeUndefined();
    expect(result.events.find((event) => event.type === "run.failed")?.payload.reason).toBe("step failed");
    expect(
      result.events.find((event) => event.type === "step.execution_finished")?.payload.feedbackReason
    ).toContain("execution_status=DONE");
  });

  it("fails when a PI Agent client returns an unknown QA action", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-engine-invalid-action-"));
    const script = path.join(dir, "invalid-action.mjs");
    fs.writeFileSync(
      script,
      `import fs from "node:fs";\nfs.writeFileSync(process.env.WFM_PI_OUTPUT_FILE, JSON.stringify({ step_id: "implement", execution_status: "QA_REJECTED", qa_routing: { action: "SKIP", feedback_reason: "not good" }, mutated_payload: { unsafe: true }, metadata: { execution_time_ms: 1, external_intervention_required: false } }));\n`,
      "utf-8"
    );
    const wf: WorkflowDefinition = {
      key: "invalid-action-wf",
      title: "invalid-action-wf",
      steps: [
        {
          key: "implement",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { payload: { command: process.execPath, args: [script], runDir: dir, timeoutMs: 5000 } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    expect(result.outputs.implement).toBeUndefined();
    expect(
      result.events.find((event) => event.type === "step.execution_finished")?.payload.feedbackReason
    ).toContain("qa_routing.action=SKIP");
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

  it("continues when controller resolves while the terminal prompt is active", async () => {
    const wf: WorkflowDefinition = {
      key: "controller-race-wf",
      title: "controller-race-wf",
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

    let resolveDecision: ((value: { decision: "approved"; actor: string; source: string }) => void) | undefined;
    let promptAborted = false;

    const resultPromise = runWorkflow(wf, {
      controller: {
        waitForDecision: () =>
          new Promise((resolve) => {
            resolveDecision = resolve as typeof resolveDecision;
          }),
      },
      approvalPrompt: ({ signal }) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            "abort",
            () => {
              promptAborted = true;
              resolve(null);
            },
            { once: true }
          );
        }),
    });

    for (let attempt = 0; attempt < 20 && !resolveDecision; attempt += 1) {
      await Bun.sleep(5);
    }
    expect(resolveDecision).toBeDefined();
    resolveDecision?.({ decision: "approved", actor: "api-user", source: "api" });

    const result = await resultPromise;
    expect(result.status).toBe("succeeded");
    expect(promptAborted).toBe(true);
    const resolved = result.events.find((event) => event.type === "approval.resolved");
    expect(resolved?.payload.actor).toBe("api-user");
    expect(resolved?.payload.source).toBe("api");
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

  it("routes acp steps through the ACP adapter when useRealAdapter and a command are set", async () => {
    const wf: WorkflowDefinition = {
      key: "acp-wf",
      title: "ACP WF",
      steps: [
        {
          key: "build",
          kind: "task",
          objective: "Build via ACP",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "acp",
            payload: {
              useRealAdapter: true,
              acpCommand: process.execPath,
              acpArgs: [ACP_FIXTURE, "--text", "acp-engine-output"],
              timeoutMs: 8000,
            },
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    expect(result.outputs.build).toMatchObject({ adapter: "acp" });
    expect(String((result.outputs.build as Record<string, unknown>).output)).toContain("acp-engine-output");
    expect(
      result.events.some((event) => event.type === "step.execution_finished" && event.payload.adapter === "acp")
    ).toBe(true);
  });

  it("mocks an acp step (and does not reach the agent) when useRealAdapter is not set", async () => {
    const wf: WorkflowDefinition = {
      key: "acp-mock-wf",
      title: "ACP Mock WF",
      steps: [
        {
          key: "build",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "acp",
            payload: { acpCommand: process.execPath, acpArgs: [ACP_FIXTURE], mockResult: "success" },
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    expect((result.outputs.build as Record<string, unknown>).output).toBeUndefined();
  });
});

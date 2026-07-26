import { describe, expect, it } from "bun:test";
import { runWorkflow } from "../src/engine.ts";
import type { RunEvent, WorkflowDefinition } from "../src/types.ts";

function indexOfType(events: RunEvent[], type: RunEvent["type"], occurrence = 0): number {
  let seen = -1;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].type === type) {
      seen += 1;
      if (seen === occurrence) return i;
    }
  }
  return -1;
}

describe("agent validation", () => {
  it("succeeds when the validator agent PROCEEDs", async () => {
    const wf: WorkflowDefinition = {
      key: "agent-validation-proceed-wf",
      title: "agent-validation-proceed-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "agent", agent: { criteria: "looks good", payload: { mockResult: "success" } } },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    expect(result.stepRuns.find((s) => s.stepKey === "s1")?.status).toBe("succeeded");

    const startedIdx = indexOfType(result.events, "step.validation_started");
    const finishedIdx = indexOfType(result.events, "step.validation_finished");
    expect(startedIdx).toBeGreaterThan(-1);
    expect(finishedIdx).toBeGreaterThan(startedIdx);

    const started = result.events[startedIdx];
    expect(started.payload.adapter).toBe("mock");
    expect(started.payload.criteria).toBe("looks good");

    const finished = result.events[finishedIdx];
    expect(finished.payload.status).toBe("SUCCESS");
    expect(finished.payload.action).toBe("PROCEED");

    // Validation runs after the step's own execution finished but before it is marked succeeded.
    const executionFinishedIdx = indexOfType(result.events, "step.execution_finished");
    expect(startedIdx).toBeGreaterThan(executionFinishedIdx);
  });

  it("retries the validated step when the validator RETRY_CURRENTs, then succeeds", async () => {
    // NOTE: runWorkflow's internal preflight (validateRuntimeRequirements, which now also
    // resolves each step's agent-validator spec per src/adapters.ts resolveValidatorAgentSpec)
    // reads this payload once, up front, before any attempt runs — hence the getter's first
    // read (index 0) is a warmup that is not tied to a real validation attempt.
    let validatorCalls = 0;
    const wf: WorkflowDefinition = {
      key: "agent-validation-retry-wf",
      title: "agent-validation-retry-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          retryPolicy: { maxAttempts: 2 },
          validation: {
            mode: "agent",
            agent: {
              payload: {
                get mockResult() {
                  return validatorCalls++ === 1 ? "retry" : "success";
                },
                feedback: "needs another pass",
              } as unknown as Record<string, unknown>,
            },
          },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    expect(result.stepRuns.find((s) => s.stepKey === "s1")?.attempt).toBe(2);
    expect(validatorCalls).toBe(3); // 1 preflight warmup read + 2 real validation attempts
    expect(result.events.filter((e) => e.type === "step.validation_started").length).toBe(2);
    expect(result.events.some((e) => e.type === "step.retried")).toBe(true);
  });

  it("fails the run with the validator's feedback_reason when retries are exhausted", async () => {
    const wf: WorkflowDefinition = {
      key: "agent-validation-retry-exhausted-wf",
      title: "agent-validation-retry-exhausted-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          retryPolicy: { maxAttempts: 1 },
          validation: {
            mode: "agent",
            agent: { payload: { mockResult: "retry", feedback: "output is missing citations" } },
          },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    const failed = result.events.find((e) => e.type === "run.failed");
    expect(String(failed?.payload.reason)).toContain("output is missing citations");
    expect(result.stepRuns.find((s) => s.stepKey === "s1")?.status).toBe("failed");
  });

  it("rolls back the previous step when the validator ROLLBACK_PREVIOUS", async () => {
    // NOTE: runWorkflow's internal preflight (validateRuntimeRequirements, which now also
    // resolves each step's agent-validator spec per src/adapters.ts resolveValidatorAgentSpec)
    // reads this payload once, up front, before any attempt runs — hence the getter's first
    // read (index 0) is a warmup that is not tied to a real validation attempt.
    let validatorCalls = 0;
    const wf: WorkflowDefinition = {
      key: "agent-validation-rollback-wf",
      title: "agent-validation-rollback-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          retryPolicy: { maxAttempts: 2 },
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
        {
          key: "s2",
          kind: "task",
          dependsOn: ["s1"],
          retryPolicy: { maxAttempts: 2 },
          validation: {
            mode: "agent",
            agent: {
              payload: {
                get mockResult() {
                  return validatorCalls++ === 1 ? "rollback" : "success";
                },
              } as unknown as Record<string, unknown>,
            },
          },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("succeeded");
    expect(validatorCalls).toBe(3); // 1 preflight warmup read + 2 real validation attempts

    const claimedForS1 = result.events.filter((e) => e.type === "step.claimed" && e.stepRunId === "s1");
    expect(claimedForS1.length).toBe(2);
    // s1's attempt counter is reset to 0 by the rollback and then re-run once (attempt 1);
    // s2 keeps its own attempt counter across the rejected-then-accepted validation (attempt 2).
    expect(result.stepRuns.find((s) => s.stepKey === "s1")?.attempt).toBe(1);
    expect(result.stepRuns.find((s) => s.stepKey === "s2")?.attempt).toBe(2);

    // Event order proves s1 re-ran (claimed a second time) after s2's validator rolled it back.
    const firstS2Claim = indexOfType(result.events, "step.claimed", 1); // s1(0), s2(1)
    const secondS1Claim = result.events.findIndex(
      (e, idx) => idx > firstS2Claim && e.type === "step.claimed" && e.stepRunId === "s1"
    );
    expect(secondS1Claim).toBeGreaterThan(firstS2Claim);

    const rollbackRetry = result.events.find(
      (e) => e.type === "step.retried" && e.stepRunId === "s1" && e.payload.via === "s2"
    );
    expect(rollbackRetry).toBeDefined();
  });

  it("fails the run with a clear reason when the validator itself FAILS", async () => {
    const wf: WorkflowDefinition = {
      key: "agent-validation-failed-wf",
      title: "agent-validation-failed-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "agent", agent: { payload: { mockResult: "fail", feedback: "validator crashed" } } },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    const failed = result.events.find((e) => e.type === "run.failed");
    expect(String(failed?.payload.reason)).toContain("agent validation failed");
    expect(String(failed?.payload.reason)).toContain("validator crashed");
  });

  it("does not let --auto-confirm-all skip agent validation", async () => {
    const wf: WorkflowDefinition = {
      key: "agent-validation-autoconfirm-wf",
      title: "agent-validation-autoconfirm-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          retryPolicy: { maxAttempts: 1 },
          validation: { mode: "agent", agent: { payload: { mockResult: "retry", feedback: "still not right" } } },
          taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
        },
      ],
    };

    // autoConfirmAll is set, but the underlying step "succeeds" — only the agent validator's
    // rejection should be able to fail this run. If validation were skipped by autoConfirmAll,
    // this run would incorrectly succeed.
    const result = await runWorkflow(wf, { autoConfirmAll: true });

    expect(result.status).toBe("failed");
    expect(result.events.some((e) => e.type === "step.validation_started")).toBe(true);
    const failed = result.events.find((e) => e.type === "run.failed");
    expect(String(failed?.payload.reason)).toContain("still not right");
  });

  it("inherits the step's useRealAdapter: false opt-out into its agent validator", async () => {
    const wf: WorkflowDefinition = {
      key: "agent-validation-inherit-mock-wf",
      title: "agent-validation-inherit-mock-wf",
      steps: [
        {
          key: "s1",
          kind: "task",
          validation: { mode: "agent", required: true },
          taskSpec: {
            adapterKey: "opencode",
            payload: { useRealAdapter: false, mockResult: "success" },
          },
        },
      ],
    };

    const result = await runWorkflow(wf, { autoConfirmAll: true });

    // If the opt-out were not inherited, the engine would try to spawn a real opencode
    // ACP agent for the validator (no acpCommand configured / no opencode binary in test
    // env), which would fail the run instead of succeeding via the mock executor.
    expect(result.status).toBe("succeeded");
    expect(result.stepRuns.find((s) => s.stepKey === "s1")?.status).toBe("succeeded");

    const startedIdx = indexOfType(result.events, "step.validation_started");
    expect(startedIdx).toBeGreaterThan(-1);
    expect(result.events[startedIdx].payload.adapter).toBe("opencode");

    const finishedIdx = indexOfType(result.events, "step.validation_finished");
    expect(finishedIdx).toBeGreaterThan(startedIdx);
    expect(result.events[finishedIdx].payload.status).toBe("SUCCESS");
    expect(result.events[finishedIdx].payload.action).toBe("PROCEED");
    // No agent.started/agent.finished ACP metadata (e.g. no real spawn attempt): the
    // validator's onFinished hook only fires with a stopReason for a real ACP run.
    const validatorFinishedEvent = result.events.find(
      (e) => e.type === "agent.finished" && e.payload.validator === true
    );
    expect(validatorFinishedEvent?.payload.stopReason).toBeUndefined();
  });
});

import { describe, expect, it } from "bun:test";
import {
  buildStepTelemetryPayloads,
  classifyFailure,
  MAX_TELEMETRY_STRING_LENGTH,
  serializeRunTelemetryPayloadV2,
  TELEMETRY_SCHEMA_VERSION,
} from "../src/remote/observability.ts";
import type { RunTelemetryPayloadV2 } from "../src/remote/observability.ts";
import type { StepRun, WorkflowDefinition } from "../src/types.ts";

const definition: WorkflowDefinition = {
  key: "obs-demo",
  title: "Observability Demo",
  steps: [
    { key: "plan", kind: "task", taskSpec: { adapterKey: "mock", init: { model: "test-model" } } },
    { key: "ship", kind: "task", taskSpec: { adapterKey: "mock" } },
    { key: "sign-off", kind: "approval" },
    { key: "notify", kind: "system" },
  ],
};

function baseStepRun(overrides: Partial<StepRun> & { stepKey: string }): StepRun {
  return {
    status: "succeeded",
    attempt: 1,
    confirmed: true,
    ...overrides,
  };
}

describe("buildStepTelemetryPayloads", () => {
  it("captures adapter, requested model, attempt, timestamps, and duration for a completed task step", () => {
    const stepRuns: StepRun[] = [
      baseStepRun({
        stepKey: "plan",
        adapter: "mock",
        requestedModel: "test-model",
        startedAt: "2026-08-04T00:00:00.000Z",
        endedAt: "2026-08-04T00:00:01.500Z",
        executionDurationMs: 1500,
      }),
    ];

    const [step] = buildStepTelemetryPayloads(definition, stepRuns);
    expect(step).toMatchObject({
      stepKey: "plan",
      stepKind: "task",
      attempt: 1,
      terminalStatus: "succeeded",
      adapter: "mock",
      requestedModel: "test-model",
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:01.500Z",
      executionDurationMs: 1500,
    });
  });

  it("emits requestedModel: null for a task step without a configured model", () => {
    const stepRuns: StepRun[] = [
      baseStepRun({ stepKey: "ship", adapter: "mock", requestedModel: null, attempt: 1 }),
    ];

    const [step] = buildStepTelemetryPayloads(definition, stepRuns);
    expect(step.requestedModel).toBeNull();
  });

  it("never claims an agent/model for approval or system steps", () => {
    const stepRuns: StepRun[] = [
      baseStepRun({ stepKey: "sign-off", attempt: 1, adapter: "mock" as never, requestedModel: "sneaky-model" }),
      baseStepRun({ stepKey: "notify", attempt: 1, adapter: "mock" as never, requestedModel: "sneaky-model" }),
    ];

    const steps = buildStepTelemetryPayloads(definition, stepRuns);
    const approval = steps.find((s) => s.stepKey === "sign-off")!;
    const system = steps.find((s) => s.stepKey === "notify")!;
    expect(approval.adapter).toBe("approval");
    expect(approval.requestedModel).toBeNull();
    expect(system.adapter).toBe("system");
    expect(system.requestedModel).toBeNull();
  });

  it("excludes steps that never started", () => {
    const stepRuns: StepRun[] = [baseStepRun({ stepKey: "plan", status: "pending", attempt: 0, confirmed: false })];
    expect(buildStepTelemetryPayloads(definition, stepRuns)).toHaveLength(0);
  });

  it("emits one telemetry record per attempt, not just the final one", () => {
    const stepRuns: StepRun[] = [
      baseStepRun({
        stepKey: "plan",
        status: "succeeded",
        attempt: 2,
        adapter: "mock",
        requestedModel: "test-model",
        startedAt: "2026-08-04T00:00:02.000Z",
        endedAt: "2026-08-04T00:00:03.000Z",
        executionDurationMs: 1000,
        attempts: [
          {
            attempt: 1,
            startedAt: "2026-08-04T00:00:00.000Z",
            endedAt: "2026-08-04T00:00:01.000Z",
            executionDurationMs: 1000,
            executionStatus: "QA_REJECTED",
            qaAction: "RETRY_CURRENT",
          },
          {
            attempt: 2,
            startedAt: "2026-08-04T00:00:02.000Z",
            endedAt: "2026-08-04T00:00:03.000Z",
            executionDurationMs: 1000,
            executionStatus: "SUCCESS",
            qaAction: "PROCEED",
          },
        ],
      }),
    ];

    const steps = buildStepTelemetryPayloads(definition, stepRuns);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      attempt: 1,
      terminalStatus: "failed",
      executionStatus: "QA_REJECTED",
      qaAction: "RETRY_CURRENT",
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:01.000Z",
    });
    expect(steps[1]).toMatchObject({
      attempt: 2,
      terminalStatus: "succeeded",
      executionStatus: "SUCCESS",
      qaAction: "PROCEED",
    });
  });

  it("falls back to a single synthesized attempt when no attempts history is present", () => {
    const stepRuns: StepRun[] = [
      baseStepRun({
        stepKey: "plan",
        adapter: "mock",
        requestedModel: "test-model",
        startedAt: "2026-08-04T00:00:00.000Z",
        endedAt: "2026-08-04T00:00:01.000Z",
        executionDurationMs: 1000,
      }),
    ];

    expect(buildStepTelemetryPayloads(definition, stepRuns)).toHaveLength(1);
  });
});

describe("classifyFailure", () => {
  it("maps validation errors to a stable category", () => {
    const { category } = classifyFailure("Invalid workflow: missing steps", "failed");
    expect(category).toBe("validation");
  });

  it("maps unrecognized failures to unknown", () => {
    const { category } = classifyFailure("kaboom", "failed");
    expect(category).toBe("unknown");
  });

  it("returns null category for a successful run", () => {
    const { category, reason } = classifyFailure("irrelevant", "succeeded");
    expect(category).toBeNull();
    expect(reason).toBeNull();
  });

  it("caps overly long failure reasons", () => {
    const longReason = "x".repeat(MAX_TELEMETRY_STRING_LENGTH + 200);
    const { reason } = classifyFailure(longReason, "failed");
    expect(reason).not.toBeNull();
    expect(reason!.length).toBeLessThanOrEqual(MAX_TELEMETRY_STRING_LENGTH);
  });
});

describe("serializeRunTelemetryPayloadV2", () => {
  function validPayload(): RunTelemetryPayloadV2 {
    return {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      runId: "run-1",
      workflowKey: "obs-demo",
      workflowTitle: "Observability Demo",
      workflowFingerprint: "sha256:abc123",
      workflowNamespaceId: null,
      workflowVersionId: null,
      workflowVersionLabel: null,
      workflowOrigin: "local",
      terminalState: "succeeded",
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:02.000Z",
      durationMs: 2000,
      totalSteps: 1,
      succeededSteps: 1,
      failedSteps: 0,
      waitingSteps: 0,
      cancelledSteps: 0,
      retriedSteps: 0,
      eventCount: 4,
      effectivenessScore: 100,
      outputKeys: ["plan"],
      cliVersion: "1.2.3",
      runnerPlatform: "darwin",
      failureCategory: null,
      failureReason: null,
      steps: [],
    };
  }

  it("rejects/strips prohibited keys smuggled onto the payload", () => {
    const malicious = {
      ...validPayload(),
      input: "raw workflow input",
      output: "raw workflow output",
      prompt: "system prompt text",
      log: "stdout dump",
      hostname: "alices-macbook",
      path: "/Users/alice/secret/workflow.json",
      token: "wm_supersecret",
    } as unknown as RunTelemetryPayloadV2;

    const serialized = serializeRunTelemetryPayloadV2(malicious) as unknown as Record<string, unknown>;
    for (const forbidden of ["input", "output", "prompt", "log", "hostname", "path", "token"]) {
      expect(serialized[forbidden]).toBeUndefined();
    }
  });

  it("caps long string fields", () => {
    const payload = validPayload();
    payload.workflowTitle = "y".repeat(MAX_TELEMETRY_STRING_LENGTH + 100);
    const serialized = serializeRunTelemetryPayloadV2(payload);
    expect(serialized.workflowTitle!.length).toBeLessThanOrEqual(MAX_TELEMETRY_STRING_LENGTH);
  });

  it("caps the number of step records", () => {
    const payload = validPayload();
    const step: RunTelemetryPayloadV2["steps"][number] = {
      stepKey: "plan",
      stepKind: "task",
      attempt: 1,
      terminalStatus: "succeeded",
      adapter: "mock",
      requestedModel: null,
      startedAt: null,
      endedAt: null,
      executionDurationMs: null,
      queueDurationMs: null,
      executionStatus: null,
      qaAction: null,
    };
    payload.steps = Array.from({ length: 700 }, () => step);
    const serialized = serializeRunTelemetryPayloadV2(payload);
    expect(serialized.steps.length).toBeLessThanOrEqual(500);
  });

  it("never lets an approval/system step carry an adapter/model through serialization", () => {
    const payload = validPayload();
    payload.steps = [
      {
        stepKey: "sign-off",
        stepKind: "approval",
        attempt: 1,
        terminalStatus: "succeeded",
        adapter: "mock" as never,
        requestedModel: "sneaky-model",
        startedAt: null,
        endedAt: null,
        executionDurationMs: null,
        queueDurationMs: null,
        executionStatus: null,
        qaAction: null,
      },
    ];
    const [step] = serializeRunTelemetryPayloadV2(payload).steps;
    expect(step.adapter).toBe("approval");
    expect(step.requestedModel).toBeNull();
  });

  it("preserves per-attempt executionStatus/qaAction through serialization", () => {
    const payload = validPayload();
    payload.steps = [
      {
        stepKey: "plan",
        stepKind: "task",
        attempt: 1,
        terminalStatus: "failed",
        adapter: "mock",
        requestedModel: null,
        startedAt: null,
        endedAt: null,
        executionDurationMs: null,
        queueDurationMs: null,
        executionStatus: "QA_REJECTED",
        qaAction: "RETRY_CURRENT",
      },
    ];
    const [step] = serializeRunTelemetryPayloadV2(payload).steps;
    expect(step.executionStatus).toBe("QA_REJECTED");
    expect(step.qaAction).toBe("RETRY_CURRENT");
  });
});

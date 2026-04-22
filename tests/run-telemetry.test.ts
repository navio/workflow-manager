import { describe, expect, it } from "bun:test";
import { buildRunTelemetryPayload } from "../src/remote/telemetry.ts";
import type { RunResult, WorkflowDefinition } from "../src/types.ts";

const definition: WorkflowDefinition = {
  key: "telemetry-demo",
  title: "Telemetry Demo",
  steps: [
    { key: "plan", kind: "task", taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } } },
    { key: "ship", kind: "task", taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } } },
  ],
};

describe("run telemetry payloads", () => {
  it("builds a success payload with effectiveness score", () => {
    const result: RunResult = {
      runId: "run-1",
      status: "succeeded",
      outputs: { plan: {}, ship: {} },
      stepRuns: [
        { stepKey: "plan", status: "succeeded", attempt: 1, confirmed: true },
        { stepKey: "ship", status: "succeeded", attempt: 2, confirmed: true },
      ],
      events: [],
    };

    const payload = buildRunTelemetryPayload({
      definition,
      sourceFilePath: "/tmp/telemetry-demo.json",
      durationMs: 3200,
      result,
    });

    expect(payload.terminalState).toBe("succeeded");
    expect(payload.retriedSteps).toBe(1);
    expect(payload.effectivenessScore).toBeGreaterThan(0);
  });

  it("builds a failed payload with failure reason", () => {
    const payload = buildRunTelemetryPayload({
      definition,
      sourceFilePath: "/tmp/telemetry-demo.md",
      durationMs: 1200,
      failureReason: "validation failed",
    });

    expect(payload.terminalState).toBe("failed");
    expect(payload.failureReason).toBe("validation failed");
    expect(payload.sourceFormat).toBe("markdown");
  });
});

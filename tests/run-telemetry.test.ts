import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRunTelemetryPayloadV2 } from "../src/remote/telemetry.ts";
import { writeWorkflowProvenance } from "../src/remote/workflowProvenance.ts";
import type { RunResult, WorkflowDefinition } from "../src/types.ts";

const definition: WorkflowDefinition = {
  key: "telemetry-demo",
  title: "Telemetry Demo",
  steps: [
    { key: "plan", kind: "task", taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } } },
    { key: "ship", kind: "task", taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } } },
  ],
};

describe("buildRunTelemetryPayloadV2", () => {
  it("builds a success payload with effectiveness score and per-step retry cost", () => {
    const result: RunResult = {
      runId: "run-1",
      status: "succeeded",
      outputs: { plan: {}, ship: {} },
      stepRuns: [
        { stepKey: "plan", status: "succeeded", attempt: 1, confirmed: true, adapter: "mock", requestedModel: null },
        { stepKey: "ship", status: "succeeded", attempt: 2, confirmed: true, adapter: "mock", requestedModel: null },
      ],
      events: [],
    };

    const payload = buildRunTelemetryPayloadV2({
      definition,
      sourceFilePath: "/tmp/telemetry-demo.json",
      durationMs: 3200,
      result,
    });

    expect(payload.schemaVersion).toBe(2);
    expect(payload.terminalState).toBe("succeeded");
    expect(payload.retriedSteps).toBe(1);
    expect(payload.effectivenessScore).toBeGreaterThan(0);
    expect(payload.steps).toHaveLength(2);
  });

  it("builds a failed payload with a classified failure category and no RunResult", () => {
    const payload = buildRunTelemetryPayloadV2({
      definition,
      sourceFilePath: "/tmp/telemetry-demo.md",
      durationMs: 1200,
      failureReason: "Invalid workflow: missing steps",
    });

    expect(payload.terminalState).toBe("failed");
    expect(payload.failureCategory).toBe("validation");
    expect(payload.failureReason).toBe("Invalid workflow: missing steps");
    expect(payload.steps).toHaveLength(0);
  });

  it("attributes a pulled workflow to its remote namespace/version via provenance", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-telemetry-provenance-"));
    const workflowPath = path.join(dir, "telemetry-demo.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");
    writeWorkflowProvenance(workflowPath, definition, {
      namespaceId: "11111111-1111-1111-1111-111111111111",
      workflowVersionId: "22222222-2222-2222-2222-222222222222",
      versionLabel: "v1",
    });

    const payload = buildRunTelemetryPayloadV2({
      definition,
      sourceFilePath: workflowPath,
      durationMs: 1000,
      result: {
        runId: "run-2",
        status: "succeeded",
        outputs: {},
        stepRuns: [],
        events: [],
      },
    });

    expect(payload.workflowOrigin).toBe("remote");
    expect(payload.workflowNamespaceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(payload.workflowVersionId).toBe("22222222-2222-2222-2222-222222222222");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats a locally modified copy of a pulled workflow as local/unattributed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-telemetry-provenance-"));
    const workflowPath = path.join(dir, "telemetry-demo.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");
    writeWorkflowProvenance(workflowPath, definition, {
      namespaceId: "11111111-1111-1111-1111-111111111111",
      workflowVersionId: "22222222-2222-2222-2222-222222222222",
      versionLabel: "v1",
    });

    const modifiedDefinition: WorkflowDefinition = { ...definition, title: "Modified Telemetry Demo" };
    const payload = buildRunTelemetryPayloadV2({
      definition: modifiedDefinition,
      sourceFilePath: workflowPath,
      durationMs: 1000,
    });

    expect(payload.workflowOrigin).toBe("local");
    expect(payload.workflowNamespaceId).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("includes run timing and per-attempt step records from the RunResult", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-telemetry-v2-"));
    const workflowPath = path.join(dir, "telemetry-demo.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");

    const result: RunResult = {
      runId: "run-3",
      status: "succeeded",
      outputs: { plan: {}, ship: {} },
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:05.000Z",
      stepRuns: [
        {
          stepKey: "plan",
          status: "succeeded",
          attempt: 1,
          confirmed: true,
          adapter: "mock",
          requestedModel: "test-model",
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:02.000Z",
          executionDurationMs: 2000,
        },
        {
          stepKey: "ship",
          status: "succeeded",
          attempt: 1,
          confirmed: true,
          adapter: "mock",
          requestedModel: null,
          startedAt: "2026-08-04T00:00:02.000Z",
          endedAt: "2026-08-04T00:00:05.000Z",
          executionDurationMs: 3000,
        },
      ],
      events: [],
    };

    const payload = buildRunTelemetryPayloadV2({
      definition,
      sourceFilePath: workflowPath,
      durationMs: 5000,
      result,
    });

    expect(payload.startedAt).toBe("2026-08-04T00:00:00.000Z");
    expect(payload.endedAt).toBe("2026-08-04T00:00:05.000Z");
    expect(payload.steps[0]).toMatchObject({ stepKey: "plan", requestedModel: "test-model", executionDurationMs: 2000 });
    expect(payload.steps[1]).toMatchObject({ stepKey: "ship", requestedModel: null });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

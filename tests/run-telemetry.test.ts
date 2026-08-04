import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRunTelemetryPayload } from "../src/remote/telemetry.ts";
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

  it("attributes a pulled workflow to its remote namespace/version via provenance metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-telemetry-provenance-"));
    const workflowPath = path.join(dir, "telemetry-demo.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");
    writeWorkflowProvenance(workflowPath, definition, {
      namespaceId: "11111111-1111-1111-1111-111111111111",
      workflowVersionId: "22222222-2222-2222-2222-222222222222",
      versionLabel: "v1",
    });

    const payload = buildRunTelemetryPayload({
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

    expect(payload.metadata?.workflowOrigin).toBe("remote");
    expect(payload.metadata?.workflowNamespaceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(payload.metadata?.workflowVersionId).toBe("22222222-2222-2222-2222-222222222222");
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
    const payload = buildRunTelemetryPayload({
      definition: modifiedDefinition,
      sourceFilePath: workflowPath,
      durationMs: 1000,
    });

    expect(payload.metadata?.workflowOrigin).toBe("local");
    expect(payload.metadata?.workflowNamespaceId).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

import { describe, expect, it } from "bun:test";
import { handleTrackRunTelemetry } from "../supabase/functions/track-run-telemetry/handler.ts";
import { handleWorkflowObservability } from "../supabase/functions/workflow-observability/handler.ts";
import { serializeRunTelemetryPayloadV2, type RunTelemetryPayloadV2 } from "../src/remote/observability.ts";

// Regression guard: if a future change adds a field to the observability/aggregate
// response without threading it through the allow-list, this test catches it by name
// rather than relying on someone noticing in review. `run_id`/`runId` are deliberately
// NOT in this list globally — the CLI ingestion payload legitimately carries `runId` as
// its idempotency key; what must never appear is a raw run/actor identifier inside an
// *aggregate* (observability) response, which is asserted separately below.
const PROHIBITED_KEY_FRAGMENTS = [
  "actorUserId",
  "actor_user_id",
  "authMethod",
  "auth_method",
  "createdAt",
  "created_at",
  "hostname",
  "sourceName",
  "source_name",
  "sourcePath",
  "filePath",
  "prompt",
  "systemPrompt",
  "mcpEndpoint",
  "token",
  "ipAddress",
];

// Legitimate on the per-run telemetry contract (runId is the idempotency key;
// failureReason is a capped, classified string) but must never appear in an *aggregate*
// observability response, which only ever reports cross-run/cross-user statistics.
const PROHIBITED_AGGREGATE_ONLY_FRAGMENTS = ["runId", "run_id", "failureReason", "failure_reason"];

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

function assertNoProhibitedKeys(payload: unknown): void {
  const keys = collectKeys(payload);
  for (const fragment of PROHIBITED_KEY_FRAGMENTS) {
    expect(keys.has(fragment)).toBe(false);
  }
}

function assertNoProhibitedAggregateKeys(payload: unknown): void {
  assertNoProhibitedKeys(payload);
  const keys = collectKeys(payload);
  for (const fragment of PROHIBITED_AGGREGATE_ONLY_FRAGMENTS) {
    expect(keys.has(fragment)).toBe(false);
  }
}

const authContext = { method: "cli_token" as const, userId: "user-1", scopes: ["workflow:read", "workflow:write"] };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("observability privacy regression", () => {
  it("never exposes a prohibited field name in the creator observability response", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability?slug=demo&window=30d"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async () => ({
        workflow: { slug: "demo", versionLabel: "v1" },
        owner: {
          totalRuns: 3,
          succeededRuns: 3,
          failedRuns: 0,
          waitingRuns: 0,
          cancelledRuns: 0,
          retriedRuns: 0,
          successRate: 100,
          averageDurationMs: 1200,
          p50DurationMs: 1100,
          p95DurationMs: 1500,
        },
        community: {
          totalRuns: 12,
          succeededRuns: 11,
          failedRuns: 1,
          waitingRuns: 0,
          cancelledRuns: 0,
          retriedRuns: 2,
          successRate: 91.67,
          averageDurationMs: 1300,
          p50DurationMs: 1150,
          p95DurationMs: 1600,
          distinctUsers: 6,
          suppressed: false,
          minimumCohort: 5,
        },
        byRuntime: [
          { adapter: "mock", requestedModel: null, totalRuns: 12, successRate: 91.67, averageDurationMs: 1300, p50DurationMs: 1150, p95DurationMs: 1600, suppressed: false },
        ],
        steps: [
          { stepKey: "plan", adapter: "mock", requestedModel: null, totalExecutions: 12, successRate: 91.67, p50ExecutionDurationMs: 500, p95ExecutionDurationMs: 900, suppressed: false },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    assertNoProhibitedAggregateKeys(payload);
  });

  it("never exposes a suppressed community segment with a numeric count", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability?slug=demo"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async () => ({
        workflow: { slug: "demo", versionLabel: "v1" },
        owner: {
          totalRuns: 1,
          succeededRuns: 1,
          failedRuns: 0,
          waitingRuns: 0,
          cancelledRuns: 0,
          retriedRuns: 0,
          successRate: 100,
          averageDurationMs: 1000,
          p50DurationMs: 1000,
          p95DurationMs: 1000,
        },
        community: {
          totalRuns: 0,
          succeededRuns: 0,
          failedRuns: 0,
          waitingRuns: 0,
          cancelledRuns: 0,
          retriedRuns: 0,
          successRate: 0,
          averageDurationMs: null,
          p50DurationMs: null,
          p95DurationMs: null,
          distinctUsers: null,
          suppressed: true,
          minimumCohort: 5,
        },
        byRuntime: [{ adapter: "mock", requestedModel: null, totalRuns: 0, successRate: 0, averageDurationMs: 0, p50DurationMs: 0, p95DurationMs: 0, suppressed: true }],
        steps: [],
      }),
    });

    const payload = await readJson(response);
    const community = payload.community as Record<string, unknown>;
    expect(community.suppressed).toBe(true);
    expect(community.distinctUsers).toBeNull();
    // Suppressed numeric fields must be null/zero, never a real 1-4 count leaking activity.
    expect(community.averageDurationMs).toBeNull();
    expect(community.p50DurationMs).toBeNull();
    expect(community.p95DurationMs).toBeNull();
  });

  it("enforces ownership: a non-owner never receives another namespace's observability data", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability?slug=someone-elses-workflow"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async () => {
        const { HttpError } = await import("../supabase/functions/_shared/responses.ts");
        throw new HttpError(403, "Only the workflow owner can view its observability data");
      },
    });

    expect(response.status).toBe(403);
    const payload = await readJson(response);
    assertNoProhibitedKeys(payload);
  });

  it("keeps V1 (legacy) and V2 ingestion schema-version-compatible without leaking prohibited fields", async () => {
    let capturedV1: Record<string, unknown> | undefined;
    let capturedV2: Record<string, unknown> | undefined;

    const v1Response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify({
          workflowKey: "legacy-demo",
          runId: "run-legacy",
          terminalState: "succeeded",
          totalSteps: 1,
          succeededSteps: 1,
          failedSteps: 0,
          waitingSteps: 0,
          cancelledSteps: 0,
          retriedSteps: 0,
          eventCount: 2,
          durationMs: 500,
          effectivenessScore: 90,
          outputKeys: [],
        }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async (_userId, _authMethod, run, steps) => {
          capturedV1 = run as unknown as Record<string, unknown>;
          assertNoProhibitedKeys(steps);
          return { id: "x", runId: run.runId, terminalState: run.terminalState, duplicate: false };
        },
      }
    );

    const v2Response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 2,
          runId: "run-v2",
          workflowKey: "v2-demo",
          workflowTitle: "V2 Demo",
          workflowFingerprint: "sha256:abc",
          workflowNamespaceId: null,
          workflowVersionId: null,
          workflowVersionLabel: null,
          workflowOrigin: "local",
          terminalState: "succeeded",
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:01.000Z",
          durationMs: 1000,
          totalSteps: 1,
          succeededSteps: 1,
          failedSteps: 0,
          waitingSteps: 0,
          cancelledSteps: 0,
          retriedSteps: 0,
          eventCount: 2,
          effectivenessScore: 100,
          outputKeys: [],
          cliVersion: "1.0.0",
          runnerPlatform: "darwin",
          failureCategory: null,
          failureReason: null,
          steps: [],
        }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async (_userId, _authMethod, run) => {
          capturedV2 = run as unknown as Record<string, unknown>;
          return { id: "x", runId: run.runId, terminalState: run.terminalState, duplicate: false };
        },
      }
    );

    expect(v1Response.status).toBe(201);
    expect(v2Response.status).toBe(201);
    expect(capturedV1?.schemaVersion).toBe(1);
    expect(capturedV2?.schemaVersion).toBe(2);
  });

  it("never lets the client-side allow-list serializer emit a prohibited field, no matter what is attached upstream", () => {
    const legit: RunTelemetryPayloadV2 = {
      schemaVersion: 2,
      runId: "run-1",
      workflowKey: "demo",
      workflowTitle: "Demo",
      workflowFingerprint: "sha256:abc",
      workflowNamespaceId: null,
      workflowVersionId: null,
      workflowVersionLabel: null,
      workflowOrigin: "local",
      terminalState: "succeeded",
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:01.000Z",
      durationMs: 1000,
      totalSteps: 1,
      succeededSteps: 1,
      failedSteps: 0,
      waitingSteps: 0,
      cancelledSteps: 0,
      retriedSteps: 0,
      eventCount: 2,
      effectivenessScore: 100,
      outputKeys: [],
      cliVersion: "1.0.0",
      runnerPlatform: "darwin",
      failureCategory: null,
      failureReason: null,
      steps: [],
    };

    const tampered = {
      ...legit,
      hostname: "victim-macbook",
      path: "/Users/victim/secret-workflow.json",
      token: "wm_leaked_token",
      prompt: "ignore previous instructions",
      input: { secret: "raw workflow input" },
      output: { secret: "raw workflow output" },
      log: "stdout dump with secrets",
    } as unknown as RunTelemetryPayloadV2;

    const serialized = serializeRunTelemetryPayloadV2(tampered);
    assertNoProhibitedKeys(serialized);
    for (const forbidden of ["hostname", "path", "token", "prompt", "input", "output", "log"]) {
      expect((serialized as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });
});

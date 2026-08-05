import { describe, expect, it } from "bun:test";
import { handleAuthWhoAmI } from "../supabase/functions/auth-whoami/handler.ts";
import { handleCreateCliToken } from "../supabase/functions/create-cli-token/handler.ts";
import { handleListCliTokens } from "../supabase/functions/list-cli-tokens/handler.ts";
import { handleManageWorkflow } from "../supabase/functions/manage-workflow/handler.ts";
import { handlePublishWorkflow } from "../supabase/functions/publish-workflow/handler.ts";
import { handlePullWorkflow } from "../supabase/functions/pull-workflow/handler.ts";
import { handleRefreshWorkflowStats } from "../supabase/functions/refresh-workflow-stats/handler.ts";
import { handleRevokeCliToken } from "../supabase/functions/revoke-cli-token/handler.ts";
import { handleSearchWorkflows, matchesSearchQuery, selectVisibleVersion } from "../supabase/functions/search-workflows/handler.ts";
import { handleTrackRunTelemetry, resolveEffectiveProvenance } from "../supabase/functions/track-run-telemetry/handler.ts";
import {
  buildCommunityWindow,
  buildOwnerWindow,
  buildRuntimeBreakdown,
  buildStepBreakdown,
  handleWorkflowObservability,
  parseWindowDays,
  percentileOf,
} from "../supabase/functions/workflow-observability/handler.ts";
import { handleWorkflowAnalytics } from "../supabase/functions/workflow-analytics/handler.ts";
import { handleWorkflowRunInsights } from "../supabase/functions/workflow-run-insights/handler.ts";
import { validateWorkflowDefinition } from "../supabase/functions/_shared/workflows.ts";

const authContext = {
  method: "cli_token" as const,
  userId: "user-1",
  scopes: ["workflow:read", "workflow:write"],
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("supabase edge handlers", () => {
  it("creates a CLI token through the handler dependency boundary", async () => {
    const response = await handleCreateCliToken(
      new Request("https://example.com/functions/v1/create-cli-token", {
        method: "POST",
        body: JSON.stringify({ name: "local-cli" }),
      }),
      {
        resolveAuthContext: async () => ({ ...authContext, method: "jwt" as const }),
        requireJwtAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        createToken: async (_req, context, body) => ({
          token: `wm_${context.userId}`,
          tokenId: "token-1",
          createdAt: "2026-04-19T00:00:00.000Z",
          expiresAt: null,
          scopes: body.scopes ?? ["workflow:read", "workflow:write"],
        }),
      }
    );

    expect(response.status).toBe(201);
    const payload = await readJson(response);
    expect(payload.token).toBe("wm_user-1");
  });

  it("revokes a CLI token", async () => {
    const response = await handleRevokeCliToken(
      new Request("https://example.com/functions/v1/revoke-cli-token", {
        method: "POST",
        body: JSON.stringify({ tokenId: "token-1" }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        revokeToken: async (userId, tokenId) => ({ tokenId: `${tokenId}:${userId}`, revokedAt: "2026-04-19T00:00:00.000Z" }),
      }
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload.tokenId).toBe("token-1:user-1");
  });

  it("returns authenticated profile data", async () => {
    const response = await handleAuthWhoAmI(new Request("https://example.com/functions/v1/auth-whoami"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      getProfile: async () => ({ username: "alice", displayName: "Alice" }),
    });

    const payload = await readJson(response);
    expect(payload.username).toBe("alice");
    expect(payload.userId).toBe("user-1");
  });

  it("lists CLI tokens for the authenticated user", async () => {
    const response = await handleListCliTokens(new Request("https://example.com/functions/v1/list-cli-tokens"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      listTokens: async () => ({
        items: [
          {
            tokenId: "token-1",
            name: "local-cli",
            scopes: ["workflow:read", "workflow:write"],
            createdAt: "2026-04-20T00:00:00.000Z",
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            active: true,
          },
        ],
      }),
    });

    const payload = await readJson(response);
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items[0]?.name).toBe("local-cli");
  });

  it("publishes a validated workflow payload", async () => {
    const response = await handlePublishWorkflow(
      new Request("https://example.com/functions/v1/publish-workflow", {
        method: "POST",
        body: JSON.stringify({
          slug: "remote-bunny",
          title: "Remote Bunny",
          versionLabel: "v1",
          sourceFormat: "json",
          rawSource: "{}",
          visibility: "public",
          publishedState: "published",
          definition: { key: "remote-bunny", title: "Remote Bunny", steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } }] },
        }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        persistWorkflow: async (userId, body) => ({ ownerUserId: userId, slug: body.slug, version: body.versionLabel, visibility: body.visibility }),
      }
    );

    expect(response.status).toBe(201);
    const payload = await readJson(response);
    expect(payload.slug).toBe("remote-bunny");
  });

  it("loads owner workflow management data", async () => {
    const response = await handleManageWorkflow(new Request("https://example.com/functions/v1/manage-workflow?slug=remote-bunny"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      getWorkflow: async () => ({
        slug: "remote-bunny",
        title: "Remote Bunny",
        description: "shared",
        visibility: "public",
        latestVersionId: "version-1",
        updatedAt: "2026-04-20T00:00:00.000Z",
        createdAt: "2026-04-19T00:00:00.000Z",
        latestTags: ["bunny"],
        versions: [{ id: "version-1", version: "v1", sourceFormat: "json", rawSource: "{}", changelog: null, publishedState: "published", createdAt: "2026-04-19T00:00:00.000Z", isLatest: true }],
      }),
    });

    const payload = await readJson(response);
    expect(payload.slug).toBe("remote-bunny");
  });

  it("updates owner workflow metadata", async () => {
    const response = await handleManageWorkflow(
      new Request("https://example.com/functions/v1/manage-workflow", {
        method: "POST",
        body: JSON.stringify({ slug: "remote-bunny", title: "Remote Bunny Updated", visibility: "private" }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        updateWorkflow: async (_userId, body) => ({ slug: body.slug, title: body.title, description: body.description ?? null, visibility: body.visibility, updatedAt: "2026-04-20T00:00:00.000Z" }),
      }
    );

    const payload = await readJson(response);
    expect(payload.visibility).toBe("private");
  });

  it("pulls a workflow payload", async () => {
    const response = await handlePullWorkflow(new Request("https://example.com/functions/v1/pull-workflow?owner=alice&slug=remote-bunny"), {
      resolveAuthContext: async () => ({ method: "anonymous", userId: null, scopes: [] }),
      enforceRateLimit: async () => "anonymous",
      recordOperation: async () => undefined,
      pullWorkflow: async () => ({ owner: "alice", slug: "remote-bunny", version: "v1", rawSource: "{}" }),
    });

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload.owner).toBe("alice");
  });

  it("searches workflows and returns summaries", async () => {
    const response = await handleSearchWorkflows(new Request("https://example.com/functions/v1/search-workflows?q=bunny"), {
      resolveAuthContext: async () => ({ method: "anonymous", userId: null, scopes: [] }),
      search: async (_context, query) => ({ items: [{ owner: "alice", slug: "remote-bunny", title: "Remote Bunny" }], count: 1, query }),
    });

    const payload = await readJson(response);
    expect(payload.count).toBe(1);
  });

  it("prefers the latest published version for public search visibility", () => {
    const version = selectVisibleVersion(
      [
        {
          id: "version-2",
          namespace_id: "namespace-1",
          version_label: "v2",
          source_format: "json",
          published_state: "draft",
          created_at: "2026-04-21T00:00:00.000Z",
        },
        {
          id: "version-1",
          namespace_id: "namespace-1",
          version_label: "v1",
          source_format: "json",
          published_state: "published",
          created_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      "version-2",
      false
    );

    expect(version?.version_label).toBe("v1");
    expect(version?.published_state).toBe("published");
  });

  it("keeps the latest draft visible to the owner", () => {
    const version = selectVisibleVersion(
      [
        {
          id: "version-2",
          namespace_id: "namespace-1",
          version_label: "v2",
          source_format: "json",
          published_state: "draft",
          created_at: "2026-04-21T00:00:00.000Z",
        },
        {
          id: "version-1",
          namespace_id: "namespace-1",
          version_label: "v1",
          source_format: "json",
          published_state: "published",
          created_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      "version-2",
      true
    );

    expect(version?.version_label).toBe("v2");
    expect(version?.published_state).toBe("draft");
  });

  it("hides draft-only workflows from anonymous search results", () => {
    const version = selectVisibleVersion(
      [
        {
          id: "version-2",
          namespace_id: "namespace-1",
          version_label: "v2",
          source_format: "json",
          published_state: "draft",
          created_at: "2026-04-21T00:00:00.000Z",
        },
        {
          id: "version-1",
          namespace_id: "namespace-1",
          version_label: "v1",
          source_format: "json",
          published_state: "draft",
          created_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      "version-2",
      false
    );

    expect(version).toBeNull();
  });

  it("matches workflow search queries against tags", () => {
    const matches = matchesSearchQuery(
      {
        owner: "alice",
        ownerDisplayName: "Alice",
        slug: "remote-bunny",
        title: "Remote Bunny",
        description: "Shared release workflow",
        visibility: "public",
        latestVersion: "v1",
        sourceFormat: "json",
        publishedState: "published",
        tags: ["release", "deploy"],
        updatedAt: "2026-04-20T00:00:00.000Z",
        createdAt: "2026-04-19T00:00:00.000Z",
      },
      "deploy"
    );

    expect(matches).toBe(true);
  });

  it("returns aggregated analytics", async () => {
    const response = await handleWorkflowAnalytics(new Request("https://example.com/functions/v1/workflow-analytics"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadAnalytics: async () => ({ items: [{ slug: "remote-bunny", totalDownloads: 5 }] }),
    });

    const payload = await readJson(response);
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items[0]?.totalDownloads).toBe(5);
  });

  function v2TelemetryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: 2,
      runId: "run-1",
      workflowKey: "telemetry-demo",
      workflowTitle: "Telemetry Demo",
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
      effectivenessScore: 95,
      outputKeys: ["plan"],
      cliVersion: "1.2.3",
      runnerPlatform: "darwin",
      failureCategory: null,
      failureReason: null,
      steps: [
        {
          stepKey: "plan",
          stepKind: "task",
          attempt: 1,
          terminalStatus: "succeeded",
          adapter: "mock",
          requestedModel: null,
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:02.000Z",
          executionDurationMs: 2000,
          queueDurationMs: null,
          executionStatus: "SUCCESS",
          qaAction: "PROCEED",
        },
      ],
      ...overrides,
    };
  }

  it("inserts a valid V2 payload's run and steps", async () => {
    let capturedSteps: unknown;
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify(v2TelemetryBody()),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async (_userId, _authMethod, run, steps) => {
          capturedSteps = steps;
          return { id: "telemetry-1", runId: run.runId, terminalState: run.terminalState, duplicate: false };
        },
      }
    );

    expect(response.status).toBe(201);
    const payload = await readJson(response);
    expect(payload.id).toBe("telemetry-1");
    expect(payload.duplicate).toBe(false);
    expect(Array.isArray(capturedSteps)).toBe(true);
    expect((capturedSteps as unknown[]).length).toBe(1);
  });

  it("returns duplicate: true on replay without erroring", async () => {
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify(v2TelemetryBody()),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async (_userId, _authMethod, run) => ({ id: "telemetry-1", runId: run.runId, terminalState: run.terminalState, duplicate: true }),
      }
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload.duplicate).toBe(true);
  });

  it("normalizes a legacy V1 (no schemaVersion) payload into a local run-only record", async () => {
    let capturedRun: Record<string, unknown> | undefined;
    let capturedSteps: unknown;
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify({
          workflowKey: "telemetry-demo",
          workflowTitle: "Telemetry Demo",
          runId: "run-legacy-1",
          terminalState: "succeeded",
          totalSteps: 2,
          succeededSteps: 2,
          failedSteps: 0,
          waitingSteps: 0,
          cancelledSteps: 0,
          retriedSteps: 0,
          eventCount: 10,
          durationMs: 1200,
          effectivenessScore: 95,
          outputKeys: ["plan", "ship"],
        }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async (_userId, _authMethod, run, steps) => {
          capturedRun = run as unknown as Record<string, unknown>;
          capturedSteps = steps;
          return { id: "telemetry-legacy-1", runId: run.runId, terminalState: run.terminalState, duplicate: false };
        },
      }
    );

    expect(response.status).toBe(201);
    expect(capturedRun?.schemaVersion).toBe(1);
    expect(capturedRun?.workflowOrigin).toBe("local");
    expect(Array.isArray(capturedSteps)).toBe(true);
    expect((capturedSteps as unknown[]).length).toBe(0);
  });

  it("rejects a malformed timestamp with 400", async () => {
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify(v2TelemetryBody({ startedAt: "not-a-date" })),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("rejects a negative duration with 400", async () => {
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify(v2TelemetryBody({ durationMs: -5 })),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unsupported adapter with 400", async () => {
    const body = v2TelemetryBody();
    (body.steps as Array<Record<string, unknown>>)[0].adapter = "totally-not-a-real-adapter";
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", { method: "POST", body: JSON.stringify(body) }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("rejects more than 500 step records with 400", async () => {
    const step = v2TelemetryBody().steps as unknown[];
    const body = v2TelemetryBody({ steps: Array.from({ length: 501 }, () => step[0]) });
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", { method: "POST", body: JSON.stringify(body) }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("rejects an oversized string field with 400", async () => {
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify(v2TelemetryBody({ workflowTitle: "x".repeat(5000) })),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("rejects a body carrying prohibited/unknown extra fields with 400", async () => {
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify({ ...v2TelemetryBody(), hostname: "alices-macbook", token: "wm_secret", path: "/Users/alice/wf.json" }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("ignores/rejects a caller-provided actor identifier rather than trusting it", async () => {
    let capturedUserId: string | undefined;
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify({ ...v2TelemetryBody(), actorUserId: "someone-elses-user-id" }),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async (userId) => {
          capturedUserId = userId;
          return { id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false };
        },
      }
    );

    // actorUserId is not an allow-listed field at all, so the whole request is rejected...
    expect(response.status).toBe(400);
    // ...and if it somehow reached insertTelemetry, only AuthContext.userId is ever used.
    expect(capturedUserId).toBeUndefined();
  });

  it("requires remote workflowOrigin to carry both namespace and version ids", async () => {
    const response = await handleTrackRunTelemetry(
      new Request("https://example.com/functions/v1/track-run-telemetry", {
        method: "POST",
        body: JSON.stringify(v2TelemetryBody({ workflowOrigin: "remote" })),
      }),
      {
        resolveAuthContext: async () => authContext,
        requireAuth: (context) => context,
        enforceRateLimit: async () => "user:user-1",
        recordOperation: async () => undefined,
        insertTelemetry: async () => ({ id: "x", runId: "run-1", terminalState: "succeeded", duplicate: false }),
      }
    );
    expect(response.status).toBe(400);
  });

  it("returns workflow run insights", async () => {
    const response = await handleWorkflowRunInsights(new Request("https://example.com/functions/v1/workflow-run-insights"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadInsights: async () => ({ items: [{ workflowKey: "telemetry-demo", totalRuns: 3, averageEffectiveness: 82 }] }),
    });

    const payload = await readJson(response);
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items[0]?.workflowKey).toBe("telemetry-demo");
  });

  it("refreshes workflow daily stats on demand", async () => {
    const response = await handleRefreshWorkflowStats(new Request("https://example.com/functions/v1/refresh-workflow-stats", { method: "POST" }), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      refreshStats: async () => ({ processed: 4 }),
    });

    const payload = await readJson(response);
    expect(payload.processed).toBe(4);
  });

  it("validates workflow definitions for unsupported adapters", () => {
    const errors = validateWorkflowDefinition({
      key: "broken",
      title: "Broken",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "unknown" } }],
    });

    expect(errors.some((error) => error.includes("Unsupported adapter"))).toBe(true);
  });

  it("accepts kimi as a supported adapter", () => {
    const errors = validateWorkflowDefinition({
      key: "kimi-wf",
      title: "Kimi WF",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "kimi" } }],
    });

    expect(errors).toEqual([]);
  });

  it("accepts gemini as a supported adapter", () => {
    const errors = validateWorkflowDefinition({
      key: "gemini-wf",
      title: "Gemini WF",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "gemini" } }],
    });

    expect(errors).toEqual([]);
  });

  it("accepts qwen as a supported adapter", () => {
    const errors = validateWorkflowDefinition({
      key: "qwen-wf",
      title: "Qwen WF",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "qwen" } }],
    });

    expect(errors).toEqual([]);
  });

  it("rejects stateFrom referencing an unknown step key", () => {
    const errors = validateWorkflowDefinition({
      key: "state-from-broken",
      title: "State From Broken",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock", init: { stateFrom: ["missing"] } } }],
    });

    expect(errors.some((error) => error.includes("stateFrom referencing unknown step"))).toBe(true);
  });

  it("rejects an invalid stateFrom value", () => {
    const errors = validateWorkflowDefinition({
      key: "state-from-invalid",
      title: "State From Invalid",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock", init: { stateFrom: 5 } } }],
    });

    expect(errors.some((error) => error.includes("has an invalid stateFrom value"))).toBe(true);
  });

  it("accepts 'all', 'none', and a valid stateFrom array cleanly", () => {
    for (const stateFrom of ["all", "none", ["plan"]]) {
      const errors = validateWorkflowDefinition({
        key: "state-from-ok",
        title: "State From OK",
        steps: [
          { key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } },
          { key: "build", kind: "task", taskSpec: { adapterKey: "mock", init: { stateFrom } } },
        ],
      });

      expect(errors).toEqual([]);
    }
  });
});

describe("resolveEffectiveProvenance", () => {
  const baseRun = {
    schemaVersion: 2 as const,
    runId: "run-1",
    workflowKey: "demo",
    workflowTitle: null,
    terminalState: "succeeded",
    totalSteps: 0,
    succeededSteps: 0,
    failedSteps: 0,
    waitingSteps: 0,
    cancelledSteps: 0,
    retriedSteps: 0,
    eventCount: 0,
    durationMs: 0,
    effectivenessScore: 0,
    outputKeys: [],
    cliVersion: null,
    failureReason: null,
    workflowFingerprint: "sha256:abc",
    workflowOrigin: "remote",
    workflowNamespaceId: "11111111-1111-1111-1111-111111111111",
    workflowVersionId: "22222222-2222-2222-2222-222222222222",
    workflowVersionLabel: "v1",
    startedAt: "2026-08-04T00:00:00.000Z",
    endedAt: "2026-08-04T00:00:01.000Z",
    runnerPlatform: "darwin",
    failureCategory: null,
    sourceName: null,
    sourceFormat: null,
    metadata: {},
  };

  it("keeps remote attribution when the version's namespace matches the claim", () => {
    const result = resolveEffectiveProvenance(baseRun, "11111111-1111-1111-1111-111111111111");
    expect(result.workflowOrigin).toBe("remote");
    expect(result.workflowNamespaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("degrades to local when the version belongs to a different namespace", () => {
    const result = resolveEffectiveProvenance(baseRun, "99999999-9999-9999-9999-999999999999");
    expect(result.workflowOrigin).toBe("local");
    expect(result.workflowNamespaceId).toBeNull();
    expect(result.workflowVersionId).toBeNull();
  });

  it("degrades to local when the claimed version no longer exists", () => {
    const result = resolveEffectiveProvenance(baseRun, null);
    expect(result.workflowOrigin).toBe("local");
  });

  it("leaves an already-local run untouched", () => {
    const localRun = { ...baseRun, workflowOrigin: "local", workflowNamespaceId: null, workflowVersionId: null };
    const result = resolveEffectiveProvenance(localRun, null);
    expect(result).toEqual(localRun);
  });
});

describe("workflow observability aggregation helpers", () => {
  it("computes nearest-rank percentiles over a sorted array", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileOf(sorted, 0.5)).toBe(60);
    expect(percentileOf(sorted, 0.95)).toBe(100);
    expect(percentileOf([], 0.5)).toBeNull();
  });

  it("parses only the allow-listed 7/30/90 day windows", () => {
    expect(parseWindowDays(null)).toBe(30);
    expect(parseWindowDays("7d")).toBe(7);
    expect(parseWindowDays("30d")).toBe(30);
    expect(parseWindowDays("90d")).toBe(90);
    expect(() => parseWindowDays("14d")).toThrow();
    expect(() => parseWindowDays("9999d")).toThrow();
  });

  it("builds an owner window that is never suppressed, even with a single run", () => {
    const window = buildOwnerWindow([{ actorUserId: "owner-1", terminalState: "succeeded", durationMs: 1000, retriedSteps: 0 }]);
    expect(window.totalRuns).toBe(1);
    expect(window.successRate).toBe(100);
  });

  it("suppresses the community window below the 5 distinct user cohort", () => {
    const rows = ["u1", "u2", "u3", "u4"].map((actorUserId) => ({ actorUserId, terminalState: "succeeded", durationMs: 1000, retriedSteps: 0 }));
    const window = buildCommunityWindow(rows);
    expect(window.suppressed).toBe(true);
    expect(window.distinctUsers).toBeNull();
    expect(window.totalRuns).toBe(0);
    expect(window.averageDurationMs).toBeNull();
  });

  it("reveals the community window once 5 distinct users contribute", () => {
    const rows = ["u1", "u2", "u3", "u4", "u5"].map((actorUserId) => ({ actorUserId, terminalState: "succeeded", durationMs: 1000, retriedSteps: 0 }));
    const window = buildCommunityWindow(rows);
    expect(window.suppressed).toBe(false);
    expect(window.distinctUsers).toBe(5);
    expect(window.totalRuns).toBe(5);
  });

  it("suppresses an individual runtime/model segment independently of the overall cohort, without leaking its label", () => {
    const popularAdapterRows = ["u1", "u2", "u3", "u4", "u5"].map((actorUserId) => ({
      actorUserId,
      adapter: "mock",
      requestedModel: null,
      stepKey: "plan",
      terminalStatus: "succeeded",
      executionDurationMs: 1000,
    }));
    const nicheAdapterRows = ["u1", "u2"].map((actorUserId) => ({
      actorUserId,
      adapter: "opencode",
      requestedModel: "gpt-5",
      stepKey: "plan",
      terminalStatus: "succeeded",
      executionDurationMs: 1000,
    }));

    const breakdown = buildRuntimeBreakdown([...popularAdapterRows, ...nicheAdapterRows]);
    const popular = breakdown.find((entry) => entry.adapter === "mock")!;
    const suppressedEntries = breakdown.filter((entry) => entry.suppressed);

    expect(popular.suppressed).toBe(false);
    expect(popular.totalRuns).toBe(5);
    // The below-threshold "opencode"/"gpt-5" combination must never appear as a labeled
    // row — even suppressed rows must not reveal which adapter/model a below-threshold
    // user chose. All suppressed groups collapse into a single dimension-free entry.
    expect(suppressedEntries).toHaveLength(1);
    expect(suppressedEntries[0].adapter).toBeNull();
    expect(suppressedEntries[0].requestedModel).toBeNull();
    expect(suppressedEntries[0].totalRuns).toBe(0);
    expect(JSON.stringify(breakdown)).not.toContain("opencode");
    expect(JSON.stringify(breakdown)).not.toContain("gpt-5");
  });

  it("computes step hotspot breakdowns keyed by step/adapter/model", () => {
    const rows = ["u1", "u2", "u3", "u4", "u5"].map((actorUserId) => ({
      actorUserId,
      adapter: "mock",
      requestedModel: null,
      stepKey: "plan",
      terminalStatus: "succeeded",
      executionDurationMs: 2000,
    }));
    const breakdown = buildStepBreakdown(rows);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toMatchObject({ stepKey: "plan", adapter: "mock", totalExecutions: 5, successRate: 100 });
  });

  it("collapses suppressed step segments into a single dimension-free entry, without leaking the step key", () => {
    const popularRows = ["u1", "u2", "u3", "u4", "u5"].map((actorUserId) => ({
      actorUserId,
      adapter: "mock",
      requestedModel: null,
      stepKey: "plan",
      terminalStatus: "succeeded",
      executionDurationMs: 1000,
    }));
    const nicheStepRows = ["u1", "u2"].map((actorUserId) => ({
      actorUserId,
      adapter: "mock",
      requestedModel: null,
      stepKey: "secret-internal-step",
      terminalStatus: "succeeded",
      executionDurationMs: 1000,
    }));

    const breakdown = buildStepBreakdown([...popularRows, ...nicheStepRows]);
    const suppressedEntries = breakdown.filter((entry) => entry.suppressed);

    expect(suppressedEntries).toHaveLength(1);
    expect(suppressedEntries[0].stepKey).toBeNull();
    expect(suppressedEntries[0].adapter).toBeNull();
    expect(suppressedEntries[0].requestedModel).toBeNull();
    expect(JSON.stringify(breakdown)).not.toContain("secret-internal-step");
  });
});

describe("workflow-observability endpoint", () => {
  it("returns 403 when a non-owner requests another namespace's observability", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability?slug=someone-elses-workflow"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async () => {
        throw new (await import("../supabase/functions/_shared/responses.ts")).HttpError(403, "Only the workflow owner can view its observability data");
      },
    });

    expect(response.status).toBe(403);
  });

  it("returns owner health, community suppression state, and breakdowns for an owned workflow", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability?slug=remote-bunny&window=30d"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async (_userId, slug) => ({
        workflow: { slug, versionLabel: "v1" },
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
        byRuntime: [],
        steps: [],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect((payload.owner as Record<string, unknown>).totalRuns).toBe(1);
    expect((payload.community as Record<string, unknown>).suppressed).toBe(true);

    const serialized = JSON.stringify(payload);
    for (const forbidden of ["actor_user_id", "authMethod", "auth_method", "runId", "run_id", "createdAt", "created_at", "failureReason", "failure_reason", "sourceName", "source_name"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects a window value outside the allow-listed range with 400", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability?slug=remote-bunny&window=14d"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async () => {
        throw new Error("loadObservability should not be called for an invalid window");
      },
    });

    expect(response.status).toBe(400);
  });

  it("requires a slug query parameter", async () => {
    const response = await handleWorkflowObservability(new Request("https://example.com/functions/v1/workflow-observability"), {
      resolveAuthContext: async () => authContext,
      requireAuth: (context) => context,
      loadObservability: async () => {
        throw new Error("loadObservability should not be called without a slug");
      },
    });

    expect(response.status).toBe(400);
  });
});

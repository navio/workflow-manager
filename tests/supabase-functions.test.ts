import { describe, expect, it } from "bun:test";
import { handleAuthWhoAmI } from "../supabase/functions/auth-whoami/handler.ts";
import { handleCreateCliToken } from "../supabase/functions/create-cli-token/handler.ts";
import { handleListCliTokens } from "../supabase/functions/list-cli-tokens/handler.ts";
import { handleManageWorkflow } from "../supabase/functions/manage-workflow/handler.ts";
import { handlePublishWorkflow } from "../supabase/functions/publish-workflow/handler.ts";
import { handlePullWorkflow } from "../supabase/functions/pull-workflow/handler.ts";
import { handleRevokeCliToken } from "../supabase/functions/revoke-cli-token/handler.ts";
import { handleSearchWorkflows } from "../supabase/functions/search-workflows/handler.ts";
import { handleWorkflowAnalytics } from "../supabase/functions/workflow-analytics/handler.ts";
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

  it("validates workflow definitions for unsupported adapters", () => {
    const errors = validateWorkflowDefinition({
      key: "broken",
      title: "Broken",
      steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "unknown" } }],
    });

    expect(errors.some((error) => error.includes("Unsupported adapter"))).toBe(true);
  });
});

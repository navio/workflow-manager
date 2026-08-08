import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import type { Session } from "@supabase/supabase-js";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { act, create } from "react-test-renderer";
import { AuthContext } from "../src/auth/auth-context";
import type { AuthContextValue } from "../src/auth/auth-context";
import type { ManagedWorkflow, WorkflowObservabilityResponse } from "../src/types";

let renderer: ReturnType<typeof create> | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeSession(): Session {
  return {
    access_token: "token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "refresh",
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    },
  } as Session;
}

function buildAuthValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    configured: true,
    loading: false,
    session: null,
    async signIn() {},
    async signUp() {},
    async signInWithGoogle() {},
    async confirmEmail() {},
    async exchangeOAuthCode() {},
    async resendConfirmation() {},
    async requestPasswordReset() {},
    async updatePassword() {},
    async signOut() {},
    ...overrides,
  };
}

function managedWorkflowFixture(): ManagedWorkflow {
  return {
    slug: "remote-bunny",
    title: "Remote Bunny",
    description: null,
    visibility: "public",
    latestVersionId: "version-1",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    latestTags: [],
    versions: [
      { id: "version-1", version: "v1", sourceFormat: "json", rawSource: "{}", changelog: null, publishedState: "published", createdAt: new Date().toISOString(), isLatest: true },
    ],
  };
}

function suppressedObservabilityFixture(): WorkflowObservabilityResponse {
  return {
    workflow: { slug: "remote-bunny", versionLabel: "v1" },
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
  };
}

function mixedBreakdownObservabilityFixture(): WorkflowObservabilityResponse {
  return {
    ...suppressedObservabilityFixture(),
    community: { ...suppressedObservabilityFixture().community, suppressed: false, distinctUsers: 7, successRate: 90, totalRuns: 7, averageDurationMs: 900, p50DurationMs: 800, p95DurationMs: 1200 },
    byRuntime: [
      { adapter: "mock", requestedModel: null, totalRuns: 7, successRate: 90, averageDurationMs: 900, p50DurationMs: 800, p95DurationMs: 1200, suppressed: false },
      { adapter: null, requestedModel: null, totalRuns: 0, successRate: 0, averageDurationMs: 0, p50DurationMs: 0, p95DurationMs: 0, suppressed: true },
    ],
    steps: [
      { stepKey: "plan", adapter: "mock", requestedModel: null, totalExecutions: 7, successRate: 90, p50ExecutionDurationMs: 400, p95ExecutionDurationMs: 600, suppressed: false },
      { stepKey: null, adapter: null, requestedModel: null, totalExecutions: 0, successRate: 0, p50ExecutionDurationMs: 0, p95ExecutionDurationMs: 0, suppressed: true },
    ],
  };
}

async function renderObservabilityPage(authValue: AuthContextValue) {
  const { WorkflowObservabilityPage } = await import("../src/pages/WorkflowObservabilityPage");
  const queryClient = new QueryClient();
  const router = createMemoryRouter(
    [{ path: "/dashboard/workflows/:slug/observability", element: createElement(WorkflowObservabilityPage) }],
    { initialEntries: ["/dashboard/workflows/remote-bunny/observability"] }
  );

  await act(async () => {
    renderer = create(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AuthContext.Provider, { value: authValue }, createElement(RouterProvider, { router }))
      )
    );
  });

  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  return renderer!;
}

function textOf(rendered: ReturnType<typeof create>): string {
  return JSON.stringify(rendered.toJSON());
}

afterEach(() => {
  if (renderer) {
    act(() => {
      renderer?.unmount();
    });
  }
  renderer = null;
});

let currentObservabilityFixture: WorkflowObservabilityResponse = suppressedObservabilityFixture();

describe("WorkflowObservabilityPage", () => {
  beforeAll(() => {
    mock.module("../src/lib/remoteApi", () => ({
      fetchManagedWorkflow: async () => managedWorkflowFixture(),
      fetchWorkflowObservability: async () => currentObservabilityFixture,
    }));
  });

  afterEach(() => {
    currentObservabilityFixture = suppressedObservabilityFixture();
  });

  it("renders owner run health and a neutral suppressed-community state without a numeric peer count", async () => {
    const rendered = await renderObservabilityPage(buildAuthValue({ session: fakeSession() }));
    const text = textOf(rendered);

    expect(text).toContain("Total runs");
    expect(text).toContain("Success rate");
    expect(text).toContain("Not enough anonymous usage yet");
    expect(text).not.toContain("Distinct users");
  });

  it("never renders a disallowed raw field name from the API contract", async () => {
    const rendered = await renderObservabilityPage(buildAuthValue({ session: fakeSession() }));
    const text = textOf(rendered);

    for (const forbidden of ["actor_user_id", "auth_method", "run_id", "failure_reason", "sourceName", "source_name"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("shows a session-expired message when there is no auth session", async () => {
    const rendered = await renderObservabilityPage(buildAuthValue({ session: null }));
    const text = textOf(rendered);

    expect(text).toContain("Session expired");
  });

  it("never renders an adapter/model/step label for a suppressed runtime or step segment", async () => {
    currentObservabilityFixture = mixedBreakdownObservabilityFixture();
    const rendered = await renderObservabilityPage(buildAuthValue({ session: fakeSession() }));
    const text = textOf(rendered);

    // The unsuppressed segment's real label is expected to render.
    expect(text).toContain("mock");
    expect(text).toContain("plan");
    // The suppressed segments' neutral messaging renders instead of any label.
    expect(text).toContain("Not enough anonymous usage yet for the remaining runtime/model combinations");
    expect(text).toContain("Not enough anonymous usage yet for the remaining steps");
  });
});

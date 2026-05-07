import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import type { Session } from "@supabase/supabase-js";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { act, create } from "react-test-renderer";
import { AuthContext } from "../src/auth/auth-context";
import type { AuthContextValue } from "../src/auth/auth-context";
import { RequireAuth } from "../src/auth/RequireAuth";

let renderer: ReturnType<typeof create> | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeSession(userId = "00000000-0000-0000-0000-000000000001"): Session {
  return {
    access_token: "token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "refresh",
    user: {
      id: userId,
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

async function renderRoute(path: string, element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: "/dashboard", element },
      { path: "/dashboard/publish", element },
      { path: "/auth", element: createElement("div", null, "Auth") },
      { path: "/onboard/handle", element: createElement("div", null, "Onboard") },
    ],
    { initialEntries: [path] }
  );

  await act(async () => {
    renderer = create(createElement(RouterProvider, { router }));
    await Promise.resolve();
    await Promise.resolve();
  });

  return router;
}

afterEach(() => {
  if (renderer) {
    act(() => {
      renderer?.unmount();
    });
  }
  renderer = null;
});

describe("RequireAuth", () => {
  it("redirects signed-out users to /auth with next query", async () => {
    const authValue = buildAuthValue({ loading: false, session: null });

    const router = await renderRoute(
      "/dashboard?tab=stats",
      createElement(
        AuthContext.Provider,
        { value: authValue },
        createElement(RequireAuth, null, createElement("div", null, "Protected"))
      )
    );

    expect(router.state.location.pathname).toBe("/auth");
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("next")).toBe("/dashboard?tab=stats");
  });

  it("allows authenticated users through", async () => {
    const authValue = buildAuthValue({ loading: false, session: fakeSession() });

    const router = await renderRoute(
      "/dashboard",
      createElement(
        AuthContext.Provider,
        { value: authValue },
        createElement(RequireAuth, null, createElement("div", null, "Protected"))
      )
    );

    expect(router.state.location.pathname).toBe("/dashboard");
  });
});

describe("RequireHandle", () => {
  let profileUsername: string | null = null;
  const fakeSupabaseClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { username: profileUsername }, error: null }),
        }),
      }),
    }),
  };

  beforeAll(async () => {
    mock.module("../src/lib/supabase", () => ({
      getSupabaseBrowserClient: () => fakeSupabaseClient,
    }));

    // Warm the mocked module path once.
    await import("../src/auth/RequireHandle");
  });

  it("redirects authenticated users without a handle to /onboard/handle", async () => {
    profileUsername = null;
    const { RequireHandle } = await import("../src/auth/RequireHandle");
    const authValue = buildAuthValue({ loading: false, session: fakeSession() });

    const router = await renderRoute(
      "/dashboard/publish?draft=1",
      createElement(
        AuthContext.Provider,
        { value: authValue },
        createElement(RequireHandle, null, createElement("div", null, "Protected"))
      )
    );

    expect(router.state.location.pathname).toBe("/onboard/handle");
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("next")).toBe("/dashboard/publish?draft=1");
  });

  it("allows authenticated users with a handle through", async () => {
    profileUsername = "alice";
    const { RequireHandle } = await import("../src/auth/RequireHandle");
    const authValue = buildAuthValue({ loading: false, session: fakeSession() });

    const router = await renderRoute(
      "/dashboard",
      createElement(
        AuthContext.Provider,
        { value: authValue },
        createElement(RequireHandle, null, createElement("div", null, "Protected"))
      )
    );

    expect(router.state.location.pathname).toBe("/dashboard");
  });
});

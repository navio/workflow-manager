import { describe, expect, it } from "bun:test";
import { actorKeyForRequest } from "../supabase/functions/_shared/ops.ts";

describe("supabase ops helpers", () => {
  it("prefers token id when available", () => {
    const actorKey = actorKeyForRequest(new Request("https://example.com"), {
      method: "cli_token",
      userId: "user-1",
      scopes: ["workflow:read"],
      tokenId: "token-1",
    });

    expect(actorKey).toBe("token:token-1");
  });

  it("falls back to forwarded ip for anonymous requests", () => {
    const actorKey = actorKeyForRequest(
      new Request("https://example.com", {
        headers: {
          "x-forwarded-for": "203.0.113.4, 10.0.0.1",
        },
      }),
      {
        method: "anonymous",
        userId: null,
        scopes: [],
      }
    );

    expect(actorKey).toBe("ip:203.0.113.4");
  });
});

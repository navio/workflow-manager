import { describe, expect, it } from "bun:test";
import { ownerIdentifier, resolveOwnerProfile } from "../supabase/functions/_shared/owner-resolution.ts";

describe("owner resolution", () => {
  it("resolves workflow owners by username before falling back to user id", async () => {
    const calls: Array<{ column: string; value: string }> = [];
    const service = {
      from: () => ({
        select: () => ({
          eq: (column: "username" | "id", value: string) => ({
            maybeSingle: async () => {
              calls.push({ column, value });
              if (column === "username") {
                return { data: { id: "user-1", username: "alice" }, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
    };

    await expect(resolveOwnerProfile(service, "alice")).resolves.toEqual({ id: "user-1", username: "alice" });
    expect(calls).toEqual([{ column: "username", value: "alice" }]);
  });

  it("falls back to the user id when no username is set", async () => {
    const service = {
      from: () => ({
        select: () => ({
          eq: (column: "username" | "id", value: string) => ({
            maybeSingle: async () => {
              if (column === "username") {
                return { data: null, error: null };
              }
              return { data: { id: value, username: null }, error: null };
            },
          }),
        }),
      }),
    };

    const profile = await resolveOwnerProfile(service, "user-2");
    expect(profile).toEqual({ id: "user-2", username: null });
    expect(ownerIdentifier(profile!)).toBe("user-2");
  });
});

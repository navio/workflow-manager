import { describe, expect, it } from "bun:test";
import { sanitizeAuthNextPath } from "../src/auth/auth-next";

describe("auth next-path sanitizer", () => {
  it("falls back to dashboard for empty or unsafe values", () => {
    expect(sanitizeAuthNextPath(null)).toBe("/dashboard");
    expect(sanitizeAuthNextPath("https://evil.example")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("//evil.example")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("relative/path")).toBe("/dashboard");
  });

  it("allows local absolute paths", () => {
    expect(sanitizeAuthNextPath("/dashboard/publish?draft=1")).toBe("/dashboard/publish?draft=1");
  });
});

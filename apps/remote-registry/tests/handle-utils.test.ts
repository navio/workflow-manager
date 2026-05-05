import { describe, expect, it } from "bun:test";
import { normalizeHandleInput, suggestHandleFromEmail, validateHandle } from "../src/lib/handle";

describe("handle helpers", () => {
  it("normalizes handle input to supported slug format", () => {
    expect(normalizeHandleInput("  My Handle__Name  ")).toBe("my-handle-name");
    expect(normalizeHandleInput("A__B---C")).toBe("a-b-c");
  });

  it("builds a handle suggestion from email local-part", () => {
    expect(suggestHandleFromEmail("Alice.Example+dev@example.com")).toBe("alice-example-dev");
    expect(suggestHandleFromEmail(null)).toBe("");
  });

  it("validates format, length, and reserved names", () => {
    expect(validateHandle("ab")).toBe("Use at least 3 characters.");
    expect(validateHandle("UPPER")).toBe("Use lowercase letters, numbers, and hyphens only.");
    expect(validateHandle("has space")).toBe("Use lowercase letters, numbers, and hyphens only.");
    expect(validateHandle("dashboard")).toBe("That handle is reserved.");
    expect(validateHandle("valid-handle-1")).toBeNull();
  });
});

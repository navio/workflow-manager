import { describe, expect, it } from "bun:test";
import { isExistingEmailSignUpResponse } from "../src/auth/signup-detection";

describe("signup duplicate-email detection", () => {
  it("flags obfuscated existing-account signup responses", () => {
    expect(isExistingEmailSignUpResponse(undefined, [])).toBe(true);
  });

  it("flags explicit already-registered errors", () => {
    expect(isExistingEmailSignUpResponse("User already registered", undefined)).toBe(true);
  });

  it("does not flag normal new-user signup responses", () => {
    expect(
      isExistingEmailSignUpResponse(undefined, [
        {
          provider: "email",
        },
      ])
    ).toBe(false);
  });

  it("does not swallow unrelated signup errors", () => {
    expect(isExistingEmailSignUpResponse("Password should be at least 8 characters", undefined)).toBe(false);
  });
});

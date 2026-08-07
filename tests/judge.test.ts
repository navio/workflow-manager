import { describe, expect, it } from "bun:test";
import { MODEL_CATALOG, lookupModel, renderCatalogForPrompt } from "../src/modelCatalog.ts";

describe("modelCatalog", () => {
  it("matches model ids case-insensitively by substring pattern", () => {
    expect(lookupModel("claude-fable-5")?.tier).toBe("frontier");
    expect(lookupModel("Claude-Haiku-4-5")?.tier).toBe("small");
    expect(lookupModel("openrouter/anthropic/claude-sonnet-5")?.tier).toBe("mid");
  });

  it("matches the more specific pattern first (codex before gpt-5, mini before gpt-5)", () => {
    expect(lookupModel("gpt-5.3-codex")?.strengths).toContain("coding");
    expect(lookupModel("gpt-5-mini")?.tier).toBe("small");
    expect(lookupModel("gpt-5")?.tier).toBe("frontier");
  });

  it("classifies gemini ids as google, not the OpenAI mini tier", () => {
    expect(lookupModel("gemini-2.5-pro")?.provider).toBe("google");
    expect(lookupModel("gpt-5-mini")?.provider).toBe("openai");
  });

  it("returns undefined for unknown or empty model ids", () => {
    expect(lookupModel("totally-unknown-model")).toBeUndefined();
    expect(lookupModel("   ")).toBeUndefined();
  });

  it("renders every catalog entry into the prompt table", () => {
    const table = renderCatalogForPrompt();
    for (const entry of MODEL_CATALOG) {
      expect(table).toContain(entry.displayName);
    }
    expect(table).toContain("Cost band");
  });
});

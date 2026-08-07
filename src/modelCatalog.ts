export type TaskCategory = "coding" | "general" | "retrieval" | "review" | "orchestration" | "summarization";

export interface ModelCatalogEntry {
  /** Case-insensitive substrings matched against TaskInitConfig.model. Order in MODEL_CATALOG matters: first match wins. */
  idPatterns: string[];
  displayName: string;
  provider: "anthropic" | "openai" | "google" | "openrouter" | "local" | "other";
  tier: "frontier" | "mid" | "small";
  /** Relative cost band, 1 (cheapest) to 5 (most expensive). Editorial, not live pricing. */
  costBand: 1 | 2 | 3 | 4 | 5;
  strengths: TaskCategory[];
  notes?: string;
}

// Hand-curated judge knowledge. Update this table when new models ship —
// the judge prompt is rendered from it, so edits here change judgments.
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    idPatterns: ["fable", "mythos"],
    displayName: "Claude Fable 5",
    provider: "anthropic",
    tier: "frontier",
    costBand: 5,
    strengths: ["coding", "review", "orchestration"],
    notes: "Top-end reasoning; overkill for retrieval/summarization steps.",
  },
  {
    idPatterns: ["opus"],
    displayName: "Claude Opus",
    provider: "anthropic",
    tier: "frontier",
    costBand: 4,
    strengths: ["coding", "review", "orchestration"],
  },
  {
    idPatterns: ["sonnet"],
    displayName: "Claude Sonnet",
    provider: "anthropic",
    tier: "mid",
    costBand: 3,
    strengths: ["coding", "general", "review"],
    notes: "Default workhorse for implementation steps.",
  },
  {
    idPatterns: ["haiku"],
    displayName: "Claude Haiku",
    provider: "anthropic",
    tier: "small",
    costBand: 2,
    strengths: ["general", "retrieval", "summarization"],
  },
  {
    idPatterns: ["codex"],
    displayName: "GPT Codex tier",
    provider: "openai",
    tier: "frontier",
    costBand: 4,
    strengths: ["coding"],
  },
  {
    idPatterns: ["mini", "nano"],
    displayName: "OpenAI mini/nano tier",
    provider: "openai",
    tier: "small",
    costBand: 2,
    strengths: ["general", "retrieval", "summarization"],
  },
  {
    idPatterns: ["gpt-5", "gpt-"],
    displayName: "GPT (full-size)",
    provider: "openai",
    tier: "frontier",
    costBand: 4,
    strengths: ["coding", "general", "review"],
  },
  {
    idPatterns: ["gemini"],
    displayName: "Gemini",
    provider: "google",
    tier: "mid",
    costBand: 2,
    strengths: ["general", "retrieval", "summarization"],
    notes: "Flash tiers are cheaper; Pro tiers are mid-cost.",
  },
  {
    idPatterns: ["ollama/", "gemma", "llama", "qwen"],
    displayName: "Local / open-weights (Ollama etc.)",
    provider: "local",
    tier: "small",
    costBand: 1,
    strengths: ["general", "summarization"],
    notes: "Free to run; quality varies widely by model and size.",
  },
];

export function lookupModel(modelId: string): ModelCatalogEntry | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return MODEL_CATALOG.find((entry) => entry.idPatterns.some((pattern) => normalized.includes(pattern.toLowerCase())));
}

export function renderCatalogForPrompt(): string {
  const lines = [
    "| Model | Provider | Tier | Cost band (1=cheapest, 5=priciest) | Strengths | Notes |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of MODEL_CATALOG) {
    lines.push(
      `| ${entry.displayName} | ${entry.provider} | ${entry.tier} | ${entry.costBand} | ${entry.strengths.join(", ")} | ${entry.notes ?? ""} |`
    );
  }
  return lines.join("\n");
}

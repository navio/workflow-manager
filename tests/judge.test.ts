import { describe, expect, it } from "bun:test";
import { MODEL_CATALOG, lookupModel, renderCatalogForPrompt } from "../src/modelCatalog.ts";
import type { WorkflowDefinition } from "../src/types.ts";
import {
  buildJudgePrompt,
  buildWorkflowDigest,
  extractFirstJsonObject,
  extractVerdictCandidate,
  parseJudgeVerdict,
  runJudge,
} from "../src/judge.ts";
import type { OutputEnvelope } from "../src/types.ts";
import { renderJudgeReport } from "../src/judgeReport.ts";

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

function demoWorkflow(): WorkflowDefinition {
  return {
    key: "demo",
    title: "Demo",
    objectives: ["ship it"],
    steps: [
      {
        key: "fetch",
        kind: "task",
        objective: "Fetch the sources",
        taskSpec: {
          adapterKey: "mock",
          init: {
            model: "claude-fable-5",
            skills: ["research"],
            systemPrompts: ["be thorough", "cite sources"],
            context: { urls: ["https://example.com"] },
            stateFrom: "none",
          },
        },
      },
      {
        key: "review",
        kind: "approval",
        dependsOn: ["fetch"],
      },
    ],
  };
}

function envelopeWith(payload: Record<string, unknown>): OutputEnvelope {
  return {
    step_id: "__judge__",
    execution_status: "SUCCESS",
    qa_routing: { action: "PROCEED", feedback_reason: "" },
    mutated_payload: payload,
    metadata: { execution_time_ms: 1, external_intervention_required: false },
  };
}

describe("buildWorkflowDigest", () => {
  it("summarizes steps without carrying full prompt content", () => {
    const digest = buildWorkflowDigest(demoWorkflow());
    expect(digest.key).toBe("demo");
    expect(digest.stepCount).toBe(2);
    const fetch = digest.steps[0];
    expect(fetch.adapterKey).toBe("mock");
    expect(fetch.model).toBe("claude-fable-5");
    expect(fetch.skills).toEqual(["research"]);
    expect(fetch.systemPromptCount).toBe(2);
    expect(fetch.systemPromptChars).toBe("be thorough".length + "cite sources".length);
    expect(fetch.contextChars).toBeGreaterThan(0);
    expect(fetch.stateFrom).toBe("none");
    const review = digest.steps[1];
    expect(review.adapterKey).toBe("approval");
    expect(review.dependsOn).toEqual(["fetch"]);
  });

  it("truncates long free-text fields at 500 chars with a marker", () => {
    const workflow = demoWorkflow();
    workflow.steps[0].objective = "x".repeat(600);
    const digest = buildWorkflowDigest(workflow);
    const objective = digest.steps[0].objective ?? "";
    expect(objective.length).toBeLessThan(600);
    expect(objective).toContain("[truncated, 600 chars total]");
  });

  it("produces identical digests for JSON and Markdown formats", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { parseWorkflowFile } = await import("../src/parser.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-judge-digest-"));
    try {
      const definition = demoWorkflow();
      const jsonPath = path.join(dir, "wf.json");
      fs.writeFileSync(jsonPath, JSON.stringify(definition, null, 2));
      const mdPath = path.join(dir, "wf.md");
      const yaml = [
        "---",
        "key: demo",
        "title: Demo",
        "objectives:",
        "  - ship it",
        "steps:",
        "  - key: fetch",
        "    kind: task",
        "    objective: Fetch the sources",
        "    taskSpec:",
        "      adapterKey: mock",
        "      init:",
        "        model: claude-fable-5",
        "        skills: [research]",
        "        systemPrompts: [be thorough, cite sources]",
        "        context:",
        "          urls: [\"https://example.com\"]",
        "        stateFrom: none",
        "  - key: review",
        "    kind: approval",
        "    dependsOn: [fetch]",
        "---",
        "# Demo",
      ].join("\n");
      fs.writeFileSync(mdPath, yaml);
      const fromJson = buildWorkflowDigest(parseWorkflowFile(jsonPath));
      const fromMd = buildWorkflowDigest(parseWorkflowFile(mdPath));
      expect(fromMd).toEqual(fromJson);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const validVerdict = {
  workflowKey: "demo",
  steps: [
    {
      stepKey: "fetch",
      category: "retrieval",
      configuredModel: "claude-fable-5",
      verdict: "overkill",
      suggestedModel: "claude-haiku-4-5",
      reasoning: "Simple retrieval; a small model suffices.",
    },
  ],
  complexityFlags: [
    { kind: "missing-state-scoping", stepKeys: ["fetch"], suggestion: "Add stateFrom to limit context." },
  ],
  summary: "One step is over-provisioned.",
};

describe("parseJudgeVerdict", () => {
  const workflow = demoWorkflow();

  it("accepts a valid verdict object", () => {
    const result = parseJudgeVerdict(validVerdict, workflow);
    if (typeof result === "string") throw new Error(result);
    expect(result.steps[0].verdict).toBe("overkill");
    expect(result.complexityFlags[0].kind).toBe("missing-state-scoping");
  });

  it("coerces unknown enum values instead of rejecting", () => {
    const raw = {
      ...validVerdict,
      steps: [{ ...validVerdict.steps[0], verdict: "way-too-big", category: "quantum" }],
      complexityFlags: [{ kind: "spooky", stepKeys: ["fetch"], suggestion: "?" }],
    };
    const result = parseJudgeVerdict(raw, workflow);
    if (typeof result === "string") throw new Error(result);
    expect(result.steps[0].verdict).toBe("unknown");
    expect(result.steps[0].category).toBe("general");
    expect(result.complexityFlags[0].kind).toBe("other");
  });

  it("drops step verdicts referencing nonexistent steps", () => {
    const raw = {
      ...validVerdict,
      steps: [...validVerdict.steps, { stepKey: "ghost", category: "general", verdict: "ok", reasoning: "n/a" }],
    };
    const result = parseJudgeVerdict(raw, workflow);
    if (typeof result === "string") throw new Error(result);
    expect(result.steps.map((s) => s.stepKey)).toEqual(["fetch"]);
  });

  it("returns an error string for unparseable input", () => {
    expect(typeof parseJudgeVerdict(undefined, workflow)).toBe("string");
    expect(typeof parseJudgeVerdict({ nope: true }, workflow)).toBe("string");
  });
});

describe("extractVerdictCandidate", () => {
  it("reads a direct judgeVerdict object", () => {
    expect(extractVerdictCandidate(envelopeWith({ judgeVerdict: validVerdict }))).toEqual(validVerdict);
  });

  it("extracts JSON from a fenced string payload", () => {
    const fenced = `Here you go:\n\`\`\`json\n${JSON.stringify(validVerdict)}\n\`\`\`\nDone.`;
    expect(extractVerdictCandidate(envelopeWith({ judgeVerdict: fenced }))).toEqual(validVerdict);
  });

  it("scans other string fields for a verdict-shaped JSON object", () => {
    const prose = `Analysis complete. ${JSON.stringify(validVerdict)} — hope that helps!`;
    expect(extractVerdictCandidate(envelopeWith({ response: prose }))).toEqual(validVerdict);
  });

  it("returns undefined when nothing parses", () => {
    expect(extractVerdictCandidate(envelopeWith({ response: "no json here {" }))).toBeUndefined();
  });
});

describe("extractFirstJsonObject", () => {
  it("handles braces inside strings", () => {
    const text = 'noise {"a": "curly } brace", "b": 2} tail';
    expect(extractFirstJsonObject(text)).toEqual({ a: "curly } brace", b: 2 });
  });
});

describe("buildJudgePrompt", () => {
  it("embeds the catalog, the digest, and the output contract", () => {
    const prompt = buildJudgePrompt(buildWorkflowDigest(demoWorkflow()));
    expect(prompt).toContain("cost band");
    expect(prompt).toContain('"fetch"');
    expect(prompt).toContain("mutated_payload.judgeVerdict");
    expect(prompt).toContain("complexityFlags");
  });
});

describe("runJudge (mock adapter)", () => {
  it("routes through the executor and returns a parsed verdict", async () => {
    const workflow = demoWorkflow();
    const result = await runJudge(workflow, "/tmp/wf.json", { adapterKey: "mock" });
    if (typeof result === "string") throw new Error(result);
    expect(result.workflowKey).toBe("demo");
    expect(result.steps.map((s) => s.stepKey)).toEqual(["fetch"]);
    expect(result.steps[0].verdict).toBe("unknown");
    expect(result.summary).toContain("Mock");
  });
});

describe("renderJudgeReport", () => {
  const verdict = {
    workflowKey: "demo",
    steps: [
      {
        stepKey: "fetch",
        category: "retrieval" as const,
        configuredModel: "claude-fable-5",
        verdict: "overkill" as const,
        suggestedModel: "claude-haiku-4-5",
        reasoning: "Simple retrieval.",
      },
      { stepKey: "draft", category: "coding" as const, verdict: "ok" as const, reasoning: "Right-sized." },
    ],
    complexityFlags: [
      { kind: "missing-state-scoping" as const, stepKeys: ["fetch"], suggestion: "Add stateFrom to limit context." },
    ],
    summary: "One step over-provisioned.",
  };

  it("renders a row per step with verdict and suggestion", () => {
    const report = renderJudgeReport(verdict);
    expect(report).toContain("fetch");
    expect(report).toContain("overkill");
    expect(report).toContain("claude-haiku-4-5");
    expect(report).toContain("draft");
    expect(report).toContain("ok");
  });

  it("renders complexity flags, summary, and the --json tip", () => {
    const report = renderJudgeReport(verdict);
    expect(report).toContain("missing-state-scoping");
    expect(report).toContain("Add stateFrom to limit context.");
    expect(report).toContain("One step over-provisioned.");
    expect(report).toContain("--json");
  });

  it("handles an empty verdict without crashing", () => {
    const report = renderJudgeReport({ workflowKey: "empty", steps: [], complexityFlags: [], summary: "" });
    expect(report).toContain("empty");
  });
});

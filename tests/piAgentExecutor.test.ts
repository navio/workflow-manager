import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executePiAgentStep, normalizeTimeout } from "../src/piAgentExecutor.ts";
import type { InputEnvelope, StepDefinition, WorkflowDefinition } from "../src/types.ts";
import { fakePiAgentScript, hangingPiAgentScript } from "./helpers/piAgentFake.ts";

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
}

function baseInput(): InputEnvelope {
  return {
    global_context: {
      workflow_id: "run-1",
      primary_objective: "test workflow",
      workflow_objectives: [],
      global_state: { feature: "PI Agent adapter" },
    },
    step_context: {
      step_id: "implement",
      step_objective: "Implement the feature",
      previous_output: {},
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: ["test-driven-development"],
      mcp_endpoints: ["filesystem"],
      system_prompts: ["Use TDD"],
      context: { repo: "workflow-manager" },
      adapter: "pi-agent",
      model: "openai/gpt-5.4-mini",
    },
  };
}

function baseStep(payloadOverrides: Record<string, unknown> = {}): StepDefinition {
  return {
    key: "implement",
    kind: "task",
    objective: "Implement the feature",
    taskSpec: {
      adapterKey: "pi-agent",
      payload: {
        timeoutMs: 5000,
        ...payloadOverrides,
      },
    },
  };
}

describe("piAgentExecutor", () => {
  it("normalizes invalid timeout values", () => {
    expect(normalizeTimeout("not-a-number")).toBe(600000);
    expect(normalizeTimeout(-1)).toBe(600000);
    expect(normalizeTimeout(0)).toBe(600000);
    expect(normalizeTimeout(5000)).toBe(5000);
  });

  it("returns a failed OutputEnvelope when the command cannot be spawned", async () => {
    const result = await executePiAgentStep(
      baseStep({ command: "/definitely/not/a/pi-agent", timeoutMs: 100 }),
      baseInput(),
      1
    );

    expect(result.step_id).toBe("implement");
    expect(result.execution_status).toBe("FAILED");
    expect(result.mutated_payload.adapter).toBe("pi-agent");
    expect(String(result.qa_routing.feedback_reason)).toContain("not");
  });

  it("returns a failed OutputEnvelope when setup cannot create the run directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-setup-"));
    const filePath = path.join(dir, "not-a-directory");
    fs.writeFileSync(filePath, "already a file", "utf-8");

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, runDir: filePath, timeoutMs: 100 }),
      baseInput(),
      1
    );

    expect(result.execution_status).toBe("FAILED");
    expect(result.qa_routing.feedback_reason).toContain("Pi setup failed");
  });

  it("writes input files and reads a Pi result envelope", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-test-"));
    const script = fakePiAgentScript(dir);

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir }),
      baseInput(),
      2
    );

    expect(result.execution_status).toBe("SUCCESS");
    expect(result.mutated_payload.sawSkills).toEqual(["test-driven-development"]);
    expect(result.mutated_payload.sawMcps).toEqual(["filesystem"]);
    expect(result.mutated_payload.sawSystemPrompts).toEqual(["Use TDD"]);
    expect(result.mutated_payload.sawContext).toEqual({ repo: "workflow-manager" });
    expect(result.mutated_payload.sawModel).toBe("openai/gpt-5.4-mini");
    expect(result.mutated_payload.sawAttempt).toBe(2);

    const metrics = result.mutated_payload.contextMetrics as {
      totalChars: number;
      sections: {
        systemPrompts: number;
        skills: { name: string; chars: number }[];
        globalState: number;
        previousOutput: number;
        context: number;
        objective: number;
      };
    };
    expect(metrics.sections.systemPrompts).toBe("Use TDD".length);
    expect(metrics.sections.globalState).toBeGreaterThan(0);
    expect(metrics.sections.previousOutput).toBe(0);
    expect(metrics.sections.context).toBeGreaterThan(0);
    expect(metrics.sections.objective).toBe("Implement the feature".length);
  });

  it("invokes the pi CLI with print mode, model, and system prompt flags", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-args-"));
    const script = fakePiAgentScript(dir);

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir }),
      baseInput(),
      1
    );

    expect(result.execution_status).toBe("SUCCESS");
    const sawArgs = result.mutated_payload.sawArgs as string[];
    expect(sawArgs).toContain("--print");
    expect(sawArgs).toContain("--no-session");
    expect(sawArgs[sawArgs.indexOf("--model") + 1]).toBe("openai/gpt-5.4-mini");
    expect(sawArgs[sawArgs.indexOf("--append-system-prompt") + 1]).toBe("Use TDD");

    const prompt = sawArgs[sawArgs.length - 1] ?? "";
    expect(prompt).toContain("Implement the feature");
    expect(prompt).toContain(path.join(dir, "output.json"));
    expect(prompt).toContain(path.join(dir, "input.json"));
  });

  it("writes resolved skills to files and passes them with --skill", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-skill-"));
    const script = fakePiAgentScript(dir);
    const workflow: WorkflowDefinition = {
      key: "wf-skills",
      title: "WF Skills",
      skills: {
        "test-driven-development": { content: "# TDD skill\nAlways write tests first." },
      },
      steps: [baseStep()],
    };

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir }),
      baseInput(),
      1,
      workflow,
      path.join(dir, "workflow.json")
    );

    expect(result.execution_status).toBe("SUCCESS");
    const sawArgs = result.mutated_payload.sawArgs as string[];
    const skillFlagIndex = sawArgs.indexOf("--skill");
    expect(skillFlagIndex).toBeGreaterThan(-1);
    const skillPath = sawArgs[skillFlagIndex + 1] ?? "";
    expect(skillPath.endsWith("SKILL.md")).toBe(true);
    expect(fs.readFileSync(skillPath, "utf-8")).toContain("Always write tests first.");

    const metrics = result.mutated_payload.contextMetrics as { sections: { skills: { name: string; chars: number }[] } };
    expect(metrics.sections.skills).toEqual([
      { name: "test-driven-development", chars: "# TDD skill\nAlways write tests first.".length },
    ]);
  });

  it("falls back to response text when pi exits cleanly without a result envelope", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-stale-"));
    const script = fakePiAgentScript(dir);

    const first = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir }),
      baseInput(),
      1
    );
    expect(first.execution_status).toBe("SUCCESS");
    expect(first.mutated_payload.sawAttempt).toBe(1);

    const noopScript = path.join(dir, "noop-pi-agent.mjs");
    fs.writeFileSync(noopScript, 'process.stdout.write("plain response");\nprocess.exit(0);\n', "utf-8");

    const second = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [noopScript], runDir: dir }),
      baseInput(),
      2
    );

    expect(second.execution_status).toBe("SUCCESS");
    expect(second.qa_routing.feedback_reason).toContain("without a result envelope");
    expect(second.mutated_payload.response).toBe("plain response");
    expect(second.mutated_payload.sawAttempt).toBeUndefined();
  });

  it("terminates a long-running child with SIGTERM and reports a distinguishable timeout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-timeout-"));
    const { script, sentinelPath } = hangingPiAgentScript(dir);

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir, timeoutMs: 150 }),
      baseInput(),
      1
    );

    expect(result.execution_status).toBe("FAILED");
    expect(result.qa_routing.feedback_reason).toBe("timed out after 150ms");
    expect(result.mutated_payload.timedOut).toBe(true);
    expect(result.mutated_payload.terminationSignal).toBe("SIGTERM");
    expect(result.mutated_payload.timeoutMs).toBe(150);
    expect(result.mutated_payload.exitStatus).toBeUndefined();

    const sawSignal = await waitFor(() => fs.existsSync(sentinelPath), 2000);
    expect(sawSignal).toBe(true);
    expect(fs.readFileSync(sentinelPath, "utf-8")).toBe("SIGTERM");
  });

  it("distinguishes a WFM timeout from a normal non-zero child exit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-exit-"));
    const script = path.join(dir, "failing-pi-agent.mjs");
    fs.writeFileSync(script, 'process.stderr.write("boom");\nprocess.exit(2);\n', "utf-8");

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir, timeoutMs: 5000 }),
      baseInput(),
      1
    );

    expect(result.execution_status).toBe("FAILED");
    expect(result.qa_routing.feedback_reason).toBe(`${process.execPath} exited with status 2`);
    expect(result.mutated_payload.exitStatus).toBe(2);
    expect(result.mutated_payload.timedOut).toBeUndefined();
    expect(result.mutated_payload.terminationSignal).toBeUndefined();
  });

  it("distinguishes a WFM timeout from a collector that writes its own error file but exits cleanly", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-pi-agent-collector-error-"));
    const script = path.join(dir, "collector-error-pi-agent.mjs");
    fs.writeFileSync(
      script,
      `import fs from "node:fs";\nimport path from "node:path";\nfs.writeFileSync(path.join(${JSON.stringify(dir)}, "collector-error-last.txt"), "Gemini request failed");\nprocess.stdout.write("handled the error internally");\nprocess.exit(0);\n`,
      "utf-8"
    );

    const result = await executePiAgentStep(
      baseStep({ command: process.execPath, args: [script], runDir: dir, timeoutMs: 5000 }),
      baseInput(),
      1
    );

    expect(result.execution_status).toBe("SUCCESS");
    expect(result.qa_routing.feedback_reason).toContain("without a result envelope");
    expect(result.mutated_payload.response).toBe("handled the error internally");
    expect(result.mutated_payload.timedOut).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, "collector-error-last.txt"), "utf-8")).toBe("Gemini request failed");
  });
});

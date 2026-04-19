import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runWorkflow } from "../src/engine.ts";
import { parseWorkflowFile } from "../src/parser.ts";

const ENABLE_REAL_OPENCODE = process.env.WORKFLOW_MANAGER_REAL_OPENCODE === "1";

function ensureOpencodeAvailable(): void {
  const probe = spawnSync("opencode", ["--version"], { encoding: "utf-8" });
  if (probe.error || probe.status !== 0) {
    const reason = probe.error?.message ?? probe.stderr ?? `exit status ${probe.status}`;
    throw new Error(`WORKFLOW_MANAGER_REAL_OPENCODE=1 set, but opencode is unavailable: ${reason}`);
  }
}

function runRealWorkflow(workflowPath: string) {
  const workflow = parseWorkflowFile(path.resolve(workflowPath));
  return runWorkflow(workflow, { autoConfirmAll: true });
}

function assertRealOpencodeResult(result: ReturnType<typeof runWorkflow>): void {
  expect(result.status).toBe("succeeded");
  const probe = result.stepRuns.find((step) => step.stepKey === "opencode_probe");
  expect(probe?.status).toBe("succeeded");
  expect(probe?.output?.realOpencode).toBe(true);

  const stdout = String(probe?.output?.stdout ?? "");
  const stderr = String(probe?.output?.stderr ?? "");
  const combined = `${stdout}\n${stderr}`;
  expect(/\d+\.\d+\.\d+/.test(combined)).toBe(true);
  expect(probe?.output?.matchesPattern).toBe(true);
}

describe("opencode real adapter e2e", () => {
  it("runs real opencode from JSON workflow when enabled", () => {
    if (!ENABLE_REAL_OPENCODE) return;
    ensureOpencodeAvailable();

    const result = runRealWorkflow("tests/fixtures/opencode-real-workflow.json");
    assertRealOpencodeResult(result);
  });

  it("runs real opencode from Markdown workflow when enabled", () => {
    if (!ENABLE_REAL_OPENCODE) return;
    ensureOpencodeAvailable();

    const result = runRealWorkflow("tests/fixtures/opencode-real-workflow.md");
    assertRealOpencodeResult(result);
  });
});

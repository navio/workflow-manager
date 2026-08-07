import { afterEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runCli(args: string[]): Promise<CliResult> {
  const entry = path.join(import.meta.dir, "..", "src", "index.ts");
  return new Promise((resolve) => {
    const child = spawn("bun", [entry, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function writeWorkflowFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-judge-cli-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "wf.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      key: "judge-cli-demo",
      title: "Judge CLI Demo",
      steps: [
        {
          key: "fetch",
          kind: "task",
          objective: "Fetch the sources",
          taskSpec: { adapterKey: "mock", init: { model: "claude-fable-5" } },
        },
      ],
    })
  );
  return filePath;
}

describe("wfm judge CLI", () => {
  it("exits 1 with usage when no file is given", async () => {
    const result = await runCli(["judge"]);
    expect(result.status).toBe(1);
  });

  it("exits 1 on an invalid workflow without judging", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-judge-cli-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "bad.json");
    fs.writeFileSync(filePath, JSON.stringify({ title: "missing key and steps" }));
    const result = await runCli(["judge", filePath]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Validation");
  });

  it("rejects an unknown adapter", async () => {
    const result = await runCli(["judge", writeWorkflowFile(), "--adapter", "nope"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown adapter");
  });

  it("judges with the mock adapter and prints a report", async () => {
    const result = await runCli(["judge", writeWorkflowFile(), "--adapter", "mock"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fetch");
    expect(result.stdout).toContain("Mock judge run");
  });

  it("emits parseable JSON with --json", async () => {
    const result = await runCli(["judge", writeWorkflowFile(), "--adapter", "mock", "--json"]);
    expect(result.status).toBe(0);
    const verdict = JSON.parse(result.stdout);
    expect(verdict.workflowKey).toBe("judge-cli-demo");
    expect(Array.isArray(verdict.steps)).toBe(true);
  });
});

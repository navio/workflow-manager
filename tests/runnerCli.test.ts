import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

interface RunningCli {
  child: ReturnType<typeof spawn>;
  stdout: string;
  stderr: string;
  wait: () => Promise<{ status: number | null; signal: NodeJS.Signals | null }>;
}

interface WaitResult {
  status: number | null;
  signal: NodeJS.Signals | null;
}

interface CliResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const tempDirs: string[] = [];
let cliTestQueue: Promise<void> = Promise.resolve();

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function runCliTestExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = cliTestQueue;
  let release: (() => void) | undefined;
  cliTestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

function writeWorkflow(delayMs = 300): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-runner-cli-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "workflow.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        key: "runner-cli-demo",
        title: "Runner CLI Demo",
        steps: [
          {
            key: "plan",
            kind: "task",
            validation: { mode: "none", required: false, autoConfirm: true },
            taskSpec: {
              adapterKey: "mock",
              payload: { mockResult: "success", delayMs },
            },
          },
        ],
      },
      null,
      2
    ),
    "utf-8"
  );
  return filePath;
}

function writeApprovalWorkflow(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-runner-cli-approval-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "workflow.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        key: "runner-cli-approval",
        title: "Runner CLI Approval",
        steps: [
          {
            key: "review",
            kind: "task",
            validation: { mode: "human", required: true, autoConfirm: false },
            taskSpec: {
              adapterKey: "mock",
              payload: { mockResult: "success" },
            },
          },
        ],
      },
      null,
      2
    ),
    "utf-8"
  );
  return filePath;
}

function startCli(args: string[]): RunningCli {
  const child = spawn(process.execPath, ["./src/index.ts", "run", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = { stdout: "", stderr: "" };
  child.stdout?.setEncoding("utf-8");
  child.stderr?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    state.stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    state.stderr += chunk;
  });

  let waitResult: WaitResult | null = null;
  let waitError: Error | null = null;
  const waiters: Array<(result: WaitResult) => void> = [];
  const failures: Array<(error: Error) => void> = [];

  child.on("error", (error) => {
    waitError = error;
    while (failures.length > 0) {
      failures.shift()?.(error);
    }
  });
  child.on("close", (status, signal) => {
    waitResult = { status, signal };
    while (waiters.length > 0) {
      waiters.shift()?.(waitResult);
    }
  });

  return {
    child,
    get stdout() {
      return state.stdout;
    },
    get stderr() {
      return state.stderr;
    },
    wait: () =>
      new Promise((resolve, reject) => {
        if (waitError) {
          reject(waitError);
          return;
        }
        if (waitResult) {
          resolve(waitResult);
          return;
        }
        waiters.push(resolve);
        failures.push(reject);
      }),
  };
}

async function runCommand(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["./src/index.ts", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function waitForAttachInfo(run: RunningCli): Promise<{ baseUrl: string; token: string }> {
  const deadline = Date.now() + 3000;
  const pattern = /Attach API: (http:\/\/127\.0\.0\.1:\d+) \(token ([^)]+)\)/;

  while (Date.now() < deadline) {
    const match = run.stderr.match(pattern);
    if (match) {
      return { baseUrl: match[1] ?? "", token: match[2] ?? "" };
    }
    await Bun.sleep(25);
  }

  throw new Error(`Timed out waiting for attach info. stderr:\n${run.stderr}`);
}

async function getFreePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const { port } = server;
  await server.stop(true);
  return port;
}

async function waitForWaitingRun(baseUrl: string, token: string): Promise<string> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const sessionResponse = await fetch(`${baseUrl}/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const session = (await sessionResponse.json()) as { run?: { runId?: string } };
    const runId = session.run?.runId;
    if (runId) {
      const runResponse = await fetch(`${baseUrl}/runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const snapshot = (await runResponse.json()) as Record<string, unknown>;
      if (snapshot.status === "waiting_for_approval") {
        return runId;
      }
    }
    await Bun.sleep(25);
  }

  throw new Error("Timed out waiting for waiting_for_approval state");
}

describe("runner CLI attach API", () => {
  it("generates a port when --port is omitted", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeWorkflow();
      const run = startCli([workflowPath, "--auto-confirm-all"]);
      const { baseUrl, token } = await waitForAttachInfo(run);
      const response = await fetch(`${baseUrl}/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const session = (await response.json()) as Record<string, unknown>;
      expect(Number(session.port)).toBeGreaterThan(0);

      const result = await run.wait();
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
    });
  });

  it("uses the provided --port value for the attach API", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeWorkflow();
      const port = await getFreePort();
      const run = startCli([workflowPath, "--auto-confirm-all", "--port", String(port)]);
      const { baseUrl, token } = await waitForAttachInfo(run);
      expect(baseUrl).toBe(`http://127.0.0.1:${port}`);

      const response = await fetch(`${baseUrl}/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const session = (await response.json()) as Record<string, unknown>;
      expect(session.port).toBe(port);

      const result = await run.wait();
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
    });
  });

  it("approves a waiting run via the CLI control command", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeApprovalWorkflow();
      const run = startCli([workflowPath]);
      const { baseUrl, token } = await waitForAttachInfo(run);
      await waitForWaitingRun(baseUrl, token);
      const approval = await runCommand([
        "approve",
        "--url",
        baseUrl,
        "--token",
        token,
        "--step",
        "review",
        "--actor",
        "qa-cli",
        "--note",
        "ship it",
      ]);
      expect(approval.status).toBe(0);
      expect(approval.stdout).toContain("approved review");

      const result = await run.wait();
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
    });
  }, 15000);

  it("cancels a waiting run via the CLI control command", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeApprovalWorkflow();
      const run = startCli([workflowPath]);
      const { baseUrl, token } = await waitForAttachInfo(run);
      await waitForWaitingRun(baseUrl, token);
      const cancellation = await runCommand([
        "cancel",
        "--url",
        baseUrl,
        "--token",
        token,
        "--step",
        "review",
        "--actor",
        "qa-cli",
        "--note",
        "stop it",
      ]);
      expect(cancellation.status).toBe(0);
      expect(cancellation.stdout).toContain("cancelled review");

      const result = await run.wait();
      expect(result.status).toBe(2);
      expect(result.signal).toBeNull();
    });
  }, 15000);

  it("fails clearly when CLI control commands are missing connection details", async () => {
    await runCliTestExclusive(async () => {
      const missingUrl = await runCommand(["approve", "--token", "abc"]);
      expect(missingUrl.status).toBe(1);
      expect(missingUrl.stderr).toContain("Missing --url");

      const missingToken = await runCommand(["approve", "--url", "http://127.0.0.1:9999"]);
      expect(missingToken.status).toBe(1);
      expect(missingToken.stderr).toContain("Missing --token");
    });
  });

  it("fails clearly when CLI control commands use a bad token", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeApprovalWorkflow();
      const run = startCli([workflowPath]);
      const { baseUrl, token } = await waitForAttachInfo(run);
      await waitForWaitingRun(baseUrl, token);

      const badAuth = await runCommand([
        "approve",
        "--url",
        baseUrl,
        "--token",
        "bad-token",
        "--step",
        "review",
      ]);
      expect(badAuth.status).toBe(1);
      expect(badAuth.stderr).toContain("Failed to discover run id");

      await runCommand(["cancel", "--url", baseUrl, "--token", token, "--step", "review"]);
      const result = await run.wait();
      expect(result.status).toBe(2);
    });
  }, 15000);

  it("resumes an external validation wait via the CLI control command", async () => {
    await runCliTestExclusive(async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-runner-cli-resume-"));
      tempDirs.push(dir);
      const workflowPath = path.join(dir, "workflow.json");
      fs.writeFileSync(
        workflowPath,
        JSON.stringify(
          {
            key: "runner-cli-resume",
            title: "Runner CLI Resume",
            steps: [
              {
                key: "deploy",
                kind: "task",
                validation: { mode: "external", required: true, autoConfirm: false },
                taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
              },
            ],
          },
          null,
          2
        ),
        "utf-8"
      );

      const run = startCli([workflowPath]);
      const { baseUrl, token } = await waitForAttachInfo(run);
      await waitForWaitingRun(baseUrl, token);

      const resumed = await runCommand([
        "resume",
        "--url",
        baseUrl,
        "--token",
        token,
        "--step",
        "deploy",
        "--actor",
        "ops-cli",
      ]);
      expect(resumed.status).toBe(0);
      expect(resumed.stdout).toContain("approved deploy");

      const result = await run.wait();
      expect(result.status).toBe(0);
    });
  }, 15000);
});

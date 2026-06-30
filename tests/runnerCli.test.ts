import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { CliRunRenderer } from "../src/cliRunRenderer.ts";
import type { RunSnapshot, StepDetailSnapshot, WorkflowDefinition } from "../src/types.ts";

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
  return writeWorkflowFile({
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
  });
}

function writeWorkflowFile(workflow: Record<string, unknown>, prefix = "wm-runner-cli-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  const filePath = path.join(dir, "workflow.json");
  fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), "utf-8");
  return filePath;
}

function writeStreamingWorkflow(): string {
  return writeWorkflowFile(
    {
      key: "runner-cli-streaming",
      title: "Runner CLI Streaming",
      steps: [
        {
          key: "plan",
          kind: "task",
          validation: { mode: "none", required: false, autoConfirm: true },
          taskSpec: {
            adapterKey: "mock",
            payload: {
              mockResult: "success",
              delayMs: 900,
              chunkDelayMs: 250,
              stdoutChunks: ["planning\n", "writing\n"],
              stderrChunks: ["warning\n"],
            },
          },
        },
      ],
    },
    "wm-runner-cli-stream-"
  );
}

function writeApprovalWorkflow(): string {
  return writeWorkflowFile(
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
    "wm-runner-cli-approval-"
  );
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

async function runCommand(
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
  cwd = process.cwd()
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "src/index.ts"), ...args], {
      cwd,
      env: { ...process.env, ...envOverrides },
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
  it("prints doctor adapter status and passes for a mock workflow", async () => {
    const workflowPath = writeWorkflowFile(
      {
        key: "runner-cli-doctor",
        title: "Runner CLI Doctor",
        steps: [
          {
            key: "plan",
            kind: "task",
            taskSpec: {
              adapterKey: "mock",
              payload: { mockResult: "success" },
            },
          },
        ],
      },
      "wm-runner-cli-doctor-"
    );

    const result = await runCommand(["doctor", workflowPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Workflow Manager Doctor");
    expect(result.stdout).toContain("acp: real");
    expect(result.stdout).toContain("OK workflow schema and runtime requirements");
  });

  it("warns in doctor when an adapter is selected but will run as mock", async () => {
    const workflowPath = writeWorkflowFile(
      {
        key: "runner-cli-doctor-warn",
        title: "Runner CLI Doctor Warn",
        steps: [
          {
            key: "review",
            kind: "task",
            taskSpec: { adapterKey: "claude-code", payload: { mockResult: "success" } },
          },
        ],
      },
      "wm-runner-cli-doctor-warn-"
    );

    const result = await runCommand(["doctor", workflowPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Adapter warnings:");
    expect(result.stdout).toContain("review: adapterKey 'claude-code'");
    expect(result.stdout).toContain("useRealAdapter: true");
  });

  it("warns before running when an adapter silently falls back to mock", async () => {
    const workflowPath = writeWorkflowFile(
      {
        key: "runner-cli-run-warn",
        title: "Runner CLI Run Warn",
        steps: [
          {
            key: "review",
            kind: "task",
            validation: { mode: "none", required: false, autoConfirm: true },
            taskSpec: { adapterKey: "claude-code", payload: { mockResult: "success" } },
          },
        ],
      },
      "wm-runner-cli-run-warn-"
    );

    const result = await runCommand(["run", workflowPath, "--auto-confirm-all"]);

    expect(result.stderr).toContain("⚠ review: adapterKey 'claude-code'");
    expect(result.stderr).toContain("useRealAdapter: true");
  });

  it("prints skill commands in usage", async () => {
    const result = await runCommand(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skill list");
    expect(result.stdout).toContain("skill install [name ...]");
    expect(result.stdout).not.toContain("agent [path]");
  });

  it("prints the package version with --version, -v, and version", async () => {
    const pkgVersion = JSON.parse(
      fs.readFileSync(path.join(import.meta.dir, "..", "package.json"), "utf-8")
    ).version as string;

    for (const flag of ["--version", "-v", "version"]) {
      const result = await runCommand([flag]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(pkgVersion);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("lists bundled skills", async () => {
    const result = await runCommand(["skill", "list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("workflow-manager-cli");
    expect(result.stdout).toContain("skill install");
  });

  it("installs the default skill for Claude Code and protects existing installs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-runner-cli-skill-"));
    tempDirs.push(dir);
    const installedSkill = path.join(dir, ".claude", "skills", "workflow-manager-cli", "SKILL.md");

    const created = await runCommand(["skill", "install"], {}, dir);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain("Installed skill workflow-manager-cli");
    const content = fs.readFileSync(installedSkill, "utf-8");
    expect(content).toContain("name: workflow-manager-cli");
    expect(content).toContain("wfm validate");

    const blocked = await runCommand(["skill", "install"], {}, dir);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("Pass --force to overwrite");

    const forced = await runCommand(["skill", "install", "--force"], {}, dir);
    expect(forced.status).toBe(0);
  });

  it("installs a named skill into a custom directory and rejects unknown inputs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-runner-cli-skill-dir-"));
    tempDirs.push(dir);

    const installed = await runCommand(["skill", "install", "doc-sync", "--dir", dir]);
    expect(installed.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "doc-sync", "SKILL.md"))).toBe(true);

    const unknownSkill = await runCommand(["skill", "install", "no-such-skill", "--dir", dir]);
    expect(unknownSkill.status).toBe(1);
    expect(unknownSkill.stderr).toContain("Unknown skill: no-such-skill");

    const unknownAgent = await runCommand(["skill", "install", "--agent", "unknown"]);
    expect(unknownAgent.status).toBe(1);
    expect(unknownAgent.stderr).toContain("Unknown --agent value");
  });

  it("prints the man page outside the repository root", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-runner-cli-man-"));
    tempDirs.push(dir);
    const result = await runCommand(["man"], {}, dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("run markdown or json workflows");
  });

  it("fails doctor for default PI Agent workflows when the host command is missing", async () => {
    const workflowPath = writeWorkflowFile(
      {
        key: "runner-cli-doctor-missing-pi",
        title: "Runner CLI Doctor Missing PI",
        steps: [
          {
            key: "plan",
            kind: "task",
            taskSpec: {},
          },
        ],
      },
      "wm-runner-cli-doctor-missing-pi-"
    );

    const result = await runCommand(["doctor", workflowPath], { PATH: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("INVALID runtime");
    expect(result.stdout).toContain("requires pi-agent command");
  });

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

describe("CliRunRenderer prompt handling", () => {
  it("pauses heartbeat output while an approval prompt is active", async () => {
    const stream = new PassThrough();
    let output = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => {
      output += chunk;
    });

    const workflow: WorkflowDefinition = {
      key: "heartbeat-demo",
      title: "Heartbeat Demo",
      steps: [{ key: "review", kind: "task", objective: "Review work" }],
    };
    const renderer = new CliRunRenderer({
      workflow,
      verbose: false,
      heartbeatMs: 20,
      stream: stream as unknown as NodeJS.WriteStream,
    });

    const snapshot: RunSnapshot = {
      runId: "run-1",
      workflowKey: workflow.key,
      workflowTitle: workflow.title,
      status: "waiting_for_approval",
      currentStepKey: "review",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      endedAt: null,
      objective: workflow.title,
      objectives: [],
      waitingForApproval: {
        stepKey: "review",
        reason: "confirmation required",
        validation: "human",
      },
      steps: [
        {
          stepKey: "review",
          status: "waiting_for_approval",
          attempt: 1,
          confirmed: false,
          adapter: "mock",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          finishedAt: null,
        },
      ],
    };
    const stepDetails: StepDetailSnapshot[] = [
      {
        ...snapshot.steps[0]!,
        kind: "task",
        objective: "Review work",
        dependsOn: [],
        config: {
          model: null,
          skills: [],
          mcps: [],
          systemPrompts: [],
          contextSummary: { type: "none" },
        },
        lastExecution: {
          executionStatus: null,
          qaAction: null,
          feedbackReason: null,
        },
      },
    ];

    renderer.onSnapshot(snapshot, stepDetails);
    await Bun.sleep(35);
    const beforePauseLength = output.length;
    expect(beforePauseLength).toBeGreaterThan(0);

    renderer.pauseHeartbeat();
    await Bun.sleep(50);
    expect(output.length).toBe(beforePauseLength);

    renderer.resumeHeartbeat();
    await Bun.sleep(35);
    expect(output.length).toBeGreaterThan(beforePauseLength);

    renderer.close();
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

  it("shows live workflow progress while a step is still running", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeWorkflow(2400);
      const run = startCli([workflowPath, "--auto-confirm-all"]);
      await waitForAttachInfo(run);

      await Bun.sleep(1200);

      expect(run.stderr).toContain('Running workflow "Runner CLI Demo"');
      expect(run.stderr).toContain("[1/1] plan");
      expect(run.stderr).toContain("1 step remaining");
      expect(run.stderr).toContain("workflow 1.");

      const result = await run.wait();
      expect(result.status).toBe(0);
      expect(run.stderr).toContain("[1/1] plan succeeded");
      expect(run.stderr).toContain("0 steps remaining");
    });
  }, 15000);

  it("streams step output when --verbose is passed", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeStreamingWorkflow();
      const run = startCli([workflowPath, "--auto-confirm-all", "--verbose"]);
      await waitForAttachInfo(run);

      await Bun.sleep(700);

      expect(run.stderr).toContain("agent started");
      expect(run.stderr).toContain("[plan stdout] planning");
      expect(run.stderr).toContain("[plan stderr] warning");

      const result = await run.wait();
      expect(result.status).toBe(0);
      expect(run.stderr).toContain("execution finished: SUCCESS");
    });
  }, 15000);

  it("keeps live progress on stderr when --json is used", async () => {
    await runCliTestExclusive(async () => {
      const workflowPath = writeWorkflow(1200);
      const result = await runCommand(["run", workflowPath, "--auto-confirm-all", "--json"]);

      expect(result.status).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      expect(result.stderr).toContain('Running workflow "Runner CLI Demo"');
      expect(result.stderr).toContain("[1/1] plan succeeded");
    });
  }, 15000);

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

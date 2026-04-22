import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { cmdAuth, cmdPublish, cmdPull } from "../src/remote/commands.ts";
import { clearRemoteConfig, configFilePath, loadRemoteConfig } from "../src/remote/config.ts";

interface CapturedRequest {
  method: string;
  pathname: string;
  authorization: string | null;
  body: string;
  search: string;
}

let configDir = "";
let remoteUrl = "";

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-remote-"));
  process.env.WORKFLOW_MANAGER_CONFIG_DIR = configDir;
});

afterEach(() => {
  delete process.env.WORKFLOW_MANAGER_CONFIG_DIR;
  delete process.env.WORKFLOW_MANAGER_REMOTE_URL;
  delete process.env.WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY;
  delete process.env.WORKFLOW_MANAGER_TOKEN;
  clearRemoteConfig();
  fs.rmSync(configDir, { recursive: true, force: true });
});

async function withServer(
  handler: (request: CapturedRequest) => Response | Promise<Response>,
  run: () => Promise<void>
): Promise<void> {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = req.method === "GET" ? "" : await req.text();
      return handler({
        method: req.method,
        pathname: new URL(req.url).pathname,
        search: new URL(req.url).search,
        authorization: req.headers.get("Authorization"),
        body,
      });
    },
  });

  remoteUrl = `http://127.0.0.1:${server.port}`;
  process.env.WORKFLOW_MANAGER_REMOTE_URL = remoteUrl;
  process.env.WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY = "test-publishable-key";

  try {
    await run();
  } finally {
    await server.stop(true);
  }
}

interface CliRunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function runCliCommand(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 10_000): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        status: null,
        signal: "SIGKILL",
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

describe("remote CLI integration helpers", () => {
  it("auth login stores the token after whoami succeeds", async () => {
    await withServer((request) => {
      expect(request.pathname).toBe("/functions/v1/auth-whoami");
      expect(request.authorization).toBe("Bearer test-token");
      return Response.json({
        userId: "user-1",
        username: "alice",
        displayName: "Alice",
        authMethod: "cli_token",
        scopes: ["workflow:read", "workflow:write"],
      });
    }, async () => {
      const exitCode = await cmdAuth(["login", "--token", "test-token"]);
      expect(exitCode).toBe(0);
      expect(loadRemoteConfig().token).toBe("test-token");
      expect(fs.existsSync(configFilePath())).toBe(true);
    });
  });

  it("publish sends the validated workflow to the remote API", async () => {
    const workflowPath = path.join(configDir, "workflow.json");
    fs.writeFileSync(
      workflowPath,
      JSON.stringify({
        key: "remote-bunny",
        title: "Remote Bunny",
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
      }),
      "utf-8"
    );
    fs.writeFileSync(configFilePath(), JSON.stringify({ token: "publish-token" }), "utf-8");

    await withServer((request) => {
      expect(request.pathname).toBe("/functions/v1/publish-workflow");
      expect(request.authorization).toBe("Bearer publish-token");
      const body = JSON.parse(request.body) as Record<string, unknown>;
      expect(body.slug).toBe("remote-bunny");
      expect(body.sourceFormat).toBe("json");
      expect((body.definition as { key: string }).key).toBe("remote-bunny");
      return Response.json({ slug: body.slug, version: body.versionLabel }, { status: 201 });
    }, async () => {
      const exitCode = await cmdPublish(workflowPath, []);
      expect(exitCode).toBe(0);
    });
  });

  it("pull writes the workflow file locally and validates it", async () => {
    const outputPath = path.join(configDir, "pulled.json");
    await withServer((request) => {
      expect(request.pathname.startsWith("/functions/v1/pull-workflow")).toBe(true);
      return Response.json({
        owner: "alice",
        slug: "remote-bunny",
        title: "Remote Bunny",
        description: "shared workflow",
        visibility: "public",
        version: "v1",
        sourceFormat: "json",
        rawSource: JSON.stringify({
          key: "remote-bunny",
          title: "Remote Bunny",
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
        }),
        definition: {
          key: "remote-bunny",
          title: "Remote Bunny",
          steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } }],
        },
        changelog: null,
        publishedState: "published",
        createdAt: new Date().toISOString(),
      });
    }, async () => {
      const exitCode = await cmdPull("alice/remote-bunny", ["--output", outputPath]);
      expect(exitCode).toBe(0);
      const pulled = JSON.parse(fs.readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
      expect(pulled.key).toBe("remote-bunny");
    });
  });

  it("run command emits telemetry when authenticated", async () => {
    const workflowPath = path.join(configDir, "telemetry.json");
    fs.writeFileSync(
      workflowPath,
      JSON.stringify({
        key: "telemetry-demo",
        title: "Telemetry Demo",
        steps: [
          {
            key: "plan",
            kind: "task",
            taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } },
          },
        ],
      }),
      "utf-8"
    );
    fs.writeFileSync(configFilePath(), JSON.stringify({ token: "telemetry-token" }), "utf-8");

    const requests: CapturedRequest[] = [];
    await withServer((request) => {
      requests.push(request);
      if (request.pathname === "/functions/v1/track-run-telemetry") {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(body.workflowKey).toBe("telemetry-demo");
        expect(body.terminalState).toBe("succeeded");
        return Response.json({ id: "telemetry-1", workflowKey: body.workflowKey, terminalState: body.terminalState }, { status: 201 });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    }, async () => {
      const result = await runCliCommand(["./src/index.ts", "run", workflowPath, "--auto-confirm-all"], {
        ...process.env,
        WORKFLOW_MANAGER_CONFIG_DIR: configDir,
        WORKFLOW_MANAGER_REMOTE_URL: remoteUrl,
        WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY: "test-publishable-key",
      });
      expect(result.timedOut).toBe(false);
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
    });

    expect(requests.some((request) => request.pathname === "/functions/v1/track-run-telemetry")).toBe(true);
  });
});

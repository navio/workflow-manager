import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { cmdAuth, cmdPublish, cmdPull, cmdTelemetry } from "../src/remote/commands.ts";
import { clearRemoteConfig, configFilePath, loadRemoteConfig } from "../src/remote/config.ts";

interface CapturedRequest {
  method: string;
  pathname: string;
  authorization: string | null;
  idempotencyKey: string | null;
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
        idempotencyKey: req.headers.get("Idempotency-Key"),
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
  function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

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

  it("telemetry command reads and persists the local preference", () => {
    expect(cmdTelemetry(["status"])).toBe(0);
    expect(loadRemoteConfig().telemetry).toBeUndefined();

    expect(cmdTelemetry(["off"])).toBe(0);
    expect(loadRemoteConfig().telemetry).toBe("off");

    expect(cmdTelemetry(["on"])).toBe(0);
    expect(loadRemoteConfig().telemetry).toBe("on");

    expect(cmdTelemetry(["bogus"])).toBe(1);
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

  it("publish bundles local skill content and hash", async () => {
    const workflowPath = path.join(configDir, "workflow-with-skills.json");
    const skillDir = path.join(configDir, "skills", "demo");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Demo skill", "utf-8");
    fs.writeFileSync(
      workflowPath,
      JSON.stringify({
        key: "remote-bunny",
        title: "Remote Bunny",
        skills: {
          demo: {
            source: "./skills/demo/SKILL.md",
            upstream: {
              repo: "github.com/acme/skills",
              ref: "abc123",
              path: "demo/SKILL.md",
            },
          },
        },
        steps: [
          {
            key: "plan",
            kind: "task",
            taskSpec: {
              adapterKey: "mock",
              init: { skills: ["demo"] },
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
      const body = JSON.parse(request.body) as Record<string, unknown>;
      const definition = body.definition as Record<string, unknown>;
      const skills = definition.skills as Record<string, Record<string, unknown>>;
      expect(skills.demo.content).toBe("# Demo skill");
      expect(skills.demo.contentSha256).toBe(sha256("# Demo skill"));
      expect((skills.demo.upstream as Record<string, string>).repo).toBe("github.com/acme/skills");
      return Response.json({ slug: body.slug, version: body.versionLabel }, { status: 201 });
    }, async () => {
      const exitCode = await cmdPublish(workflowPath, []);
      expect(exitCode).toBe(0);
    });
  });

  it("publish stores bundled markdown workflows as json artifacts", async () => {
    const workflowPath = path.join(configDir, "workflow-with-skills.md");
    const skillDir = path.join(configDir, "skills", "demo");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Demo skill", "utf-8");
    fs.writeFileSync(
      workflowPath,
      `---
key: remote-bunny
title: Remote Bunny
skills:
  demo:
    source: ./skills/demo/SKILL.md
steps:
  - key: plan
    kind: task
    taskSpec:
      adapterKey: mock
      init:
        skills: [demo]
      payload:
        mockResult: success
---
`,
      "utf-8"
    );
    fs.writeFileSync(configFilePath(), JSON.stringify({ token: "publish-token" }), "utf-8");

    await withServer((request) => {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      expect(body.sourceFormat).toBe("json");
      const rawSource = JSON.parse(String(body.rawSource)) as Record<string, unknown>;
      const skills = rawSource.skills as Record<string, Record<string, unknown>>;
      expect(skills.demo.content).toBe("# Demo skill");
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

  it("pull writes a private provenance sidecar when the server returns namespace/version identifiers", async () => {
    const outputPath = path.join(configDir, "pulled-with-provenance.json");
    await withServer(() => {
      return Response.json({
        owner: "alice",
        slug: "remote-bunny",
        title: "Remote Bunny",
        description: "shared workflow",
        visibility: "public",
        version: "v1.2.0",
        sourceFormat: "json",
        rawSource: JSON.stringify({
          key: "remote-bunny",
          title: "Remote Bunny",
          steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } } }],
        }),
        definition: {
          key: "remote-bunny",
          title: "Remote Bunny",
          steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } }],
        },
        changelog: null,
        publishedState: "published",
        createdAt: new Date().toISOString(),
        namespaceId: "11111111-1111-1111-1111-111111111111",
        versionId: "22222222-2222-2222-2222-222222222222",
      });
    }, async () => {
      const exitCode = await cmdPull("alice/remote-bunny", ["--output", outputPath]);
      expect(exitCode).toBe(0);
      const sidecarPath = `${outputPath}.wfm-provenance.json`;
      expect(fs.existsSync(sidecarPath)).toBe(true);
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf-8")) as Record<string, unknown>;
      expect(sidecar.namespaceId).toBe("11111111-1111-1111-1111-111111111111");
      expect(sidecar.workflowVersionId).toBe("22222222-2222-2222-2222-222222222222");
      expect(sidecar.versionLabel).toBe("v1.2.0");
      expect(typeof sidecar.workflowFingerprint).toBe("string");
    });
  });

  it("pull does not write a provenance sidecar when the server omits namespace/version identifiers", async () => {
    const outputPath = path.join(configDir, "pulled-no-provenance.json");
    await withServer(() => {
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
          steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock", payload: { mockResult: "success" } } }],
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
      expect(fs.existsSync(`${outputPath}.wfm-provenance.json`)).toBe(false);
    });
  });

  it("pull rejects workflows that do not embed required skill content", async () => {
    const outputPath = path.join(configDir, "pulled-missing-content.json");
    await withServer(() => {
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
          skills: {
            demo: {
              source: "./skills/demo/SKILL.md",
            },
          },
          steps: [
            {
              key: "plan",
              kind: "task",
              taskSpec: {
                adapterKey: "mock",
                init: { skills: ["demo"] },
                payload: { mockResult: "success" },
              },
            },
          ],
        }),
        definition: {
          key: "remote-bunny",
          title: "Remote Bunny",
          skills: { demo: { source: "./skills/demo/SKILL.md" } },
          steps: [{ key: "plan", kind: "task", taskSpec: { adapterKey: "mock" } }],
        },
        changelog: null,
        publishedState: "published",
        createdAt: new Date().toISOString(),
      });
    }, async () => {
      const exitCode = await cmdPull("alice/remote-bunny", ["--output", outputPath]);
      expect(exitCode).toBe(1);
      expect(fs.existsSync(outputPath)).toBe(false);
    });
  });

  function writeTelemetryWorkflow(): string {
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
    return workflowPath;
  }

  it("run command emits V2 telemetry, keyed by run id, when authenticated", async () => {
    const workflowPath = writeTelemetryWorkflow();
    fs.writeFileSync(configFilePath(), JSON.stringify({ token: "telemetry-token" }), "utf-8");

    const requests: CapturedRequest[] = [];
    let capturedRunId: string | undefined;
    await withServer((request) => {
      requests.push(request);
      if (request.pathname === "/functions/v1/track-run-telemetry") {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(body.schemaVersion).toBe(2);
        expect(body.workflowKey).toBe("telemetry-demo");
        expect(body.terminalState).toBe("succeeded");
        expect(Array.isArray(body.steps)).toBe(true);
        expect(request.idempotencyKey).toBe(body.runId as string);
        capturedRunId = body.runId as string;
        return Response.json({ id: "telemetry-1", runId: body.runId, terminalState: body.terminalState, duplicate: false }, { status: 201 });
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
    expect(capturedRunId).toBeTruthy();
  });

  it("does not send telemetry for an unauthenticated run", async () => {
    const workflowPath = writeTelemetryWorkflow();

    const requests: CapturedRequest[] = [];
    await withServer((request) => {
      requests.push(request);
      return Response.json({ error: "unexpected" }, { status: 500 });
    }, async () => {
      const result = await runCliCommand(["./src/index.ts", "run", workflowPath, "--auto-confirm-all"], {
        ...process.env,
        WORKFLOW_MANAGER_CONFIG_DIR: configDir,
        WORKFLOW_MANAGER_REMOTE_URL: remoteUrl,
        WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY: "test-publishable-key",
      });
      expect(result.status).toBe(0);
    });

    expect(requests.some((request) => request.pathname === "/functions/v1/track-run-telemetry")).toBe(false);
  });

  it("does not send telemetry when WFM_TELEMETRY=off, even for an authenticated run", async () => {
    const workflowPath = writeTelemetryWorkflow();
    fs.writeFileSync(configFilePath(), JSON.stringify({ token: "telemetry-token" }), "utf-8");

    const requests: CapturedRequest[] = [];
    await withServer((request) => {
      requests.push(request);
      return Response.json({ error: "unexpected" }, { status: 500 });
    }, async () => {
      const result = await runCliCommand(["./src/index.ts", "run", workflowPath, "--auto-confirm-all"], {
        ...process.env,
        WORKFLOW_MANAGER_CONFIG_DIR: configDir,
        WORKFLOW_MANAGER_REMOTE_URL: remoteUrl,
        WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY: "test-publishable-key",
        WFM_TELEMETRY: "off",
      });
      expect(result.status).toBe(0);
    });

    expect(requests.some((request) => request.pathname === "/functions/v1/track-run-telemetry")).toBe(false);
  });

  it("keeps --json stdout clean and the exit code unaffected when telemetry transport fails", async () => {
    const workflowPath = writeTelemetryWorkflow();
    fs.writeFileSync(configFilePath(), JSON.stringify({ token: "telemetry-token" }), "utf-8");

    await withServer((request) => {
      if (request.pathname === "/functions/v1/track-run-telemetry") {
        return Response.json({ error: "telemetry backend unavailable" }, { status: 500 });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    }, async () => {
      const result = await runCliCommand(["./src/index.ts", "run", workflowPath, "--auto-confirm-all", "--json"], {
        ...process.env,
        WORKFLOW_MANAGER_CONFIG_DIR: configDir,
        WORKFLOW_MANAGER_REMOTE_URL: remoteUrl,
        WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY: "test-publishable-key",
      });
      expect(result.status).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed.status).toBe("succeeded");
      expect(result.stderr).toContain("Telemetry warning");
    });
  });
});

describe("workflow provenance", () => {
  const definition = {
    key: "prov-demo",
    title: "Provenance Demo",
    steps: [{ key: "plan", kind: "task" as const, taskSpec: { adapterKey: "mock" as const } }],
  };

  it("resolves as local when no sidecar exists", async () => {
    const { resolveWorkflowProvenance } = await import("../src/remote/workflowProvenance.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-provenance-"));
    const workflowPath = path.join(dir, "workflow.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");

    const resolved = resolveWorkflowProvenance(workflowPath, definition);
    expect(resolved.origin).toBe("local");
    expect(resolved.namespaceId).toBeNull();
    expect(resolved.workflowVersionId).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves as remote when a matching sidecar exists", async () => {
    const { resolveWorkflowProvenance, writeWorkflowProvenance } = await import("../src/remote/workflowProvenance.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-provenance-"));
    const workflowPath = path.join(dir, "workflow.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");
    writeWorkflowProvenance(workflowPath, definition, {
      namespaceId: "11111111-1111-1111-1111-111111111111",
      workflowVersionId: "22222222-2222-2222-2222-222222222222",
      versionLabel: "v1",
    });

    const resolved = resolveWorkflowProvenance(workflowPath, definition);
    expect(resolved.origin).toBe("remote");
    expect(resolved.namespaceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(resolved.workflowVersionId).toBe("22222222-2222-2222-2222-222222222222");
    expect(resolved.versionLabel).toBe("v1");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to local when the workflow content no longer matches the sidecar fingerprint", async () => {
    const { resolveWorkflowProvenance, writeWorkflowProvenance } = await import("../src/remote/workflowProvenance.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-provenance-"));
    const workflowPath = path.join(dir, "workflow.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");
    writeWorkflowProvenance(workflowPath, definition, {
      namespaceId: "11111111-1111-1111-1111-111111111111",
      workflowVersionId: "22222222-2222-2222-2222-222222222222",
      versionLabel: "v1",
    });

    const modifiedDefinition = { ...definition, title: "Modified locally" };
    const resolved = resolveWorkflowProvenance(workflowPath, modifiedDefinition);
    expect(resolved.origin).toBe("local");
    expect(resolved.namespaceId).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to local when the sidecar is malformed", async () => {
    const { resolveWorkflowProvenance } = await import("../src/remote/workflowProvenance.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-provenance-"));
    const workflowPath = path.join(dir, "workflow.json");
    fs.writeFileSync(workflowPath, JSON.stringify(definition), "utf-8");
    fs.writeFileSync(`${workflowPath}.wfm-provenance.json`, "not json", "utf-8");

    const resolved = resolveWorkflowProvenance(workflowPath, definition);
    expect(resolved.origin).toBe("local");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("produces the same fingerprint regardless of key ordering", async () => {
    const { computeWorkflowFingerprint } = await import("../src/remote/workflowProvenance.ts");
    const a = { title: "Provenance Demo", key: "prov-demo", steps: definition.steps };
    const b = { key: "prov-demo", title: "Provenance Demo", steps: definition.steps };
    expect(computeWorkflowFingerprint(a as never)).toBe(computeWorkflowFingerprint(b as never));
  });
});

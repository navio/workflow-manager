import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

interface ScriptRunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const scriptPath = path.join(process.cwd(), "scripts", "install.sh");
const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

async function runInstallScript(env: NodeJS.ProcessEnv): Promise<ScriptRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath], {
      cwd: process.cwd(),
      env,
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

describe("remote installer", () => {
  it("downloads the matching asset and installs it to the requested directory", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname !== "/wfm-linux-x64") {
          return new Response("not found", { status: 404 });
        }

        return new Response("#!/bin/sh\nprintf 'wfm test binary\\n'\n", {
          headers: {
            "Content-Type": "application/octet-stream",
          },
        });
      },
    });

    try {
      const result = await runInstallScript({
        ...process.env,
        PATH: process.env.PATH ?? "",
        WORKFLOW_MANAGER_INSTALL_BASE_URL: `http://127.0.0.1:${server.port}`,
        WORKFLOW_MANAGER_INSTALL_DIR: installDir,
        WORKFLOW_MANAGER_INSTALL_OS: "linux",
        WORKFLOW_MANAGER_INSTALL_ARCH: "x86_64",
      });

      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stdout).toContain("Installed wfm");

      const installedPath = path.join(installDir, "wfm");
      expect(fs.existsSync(installedPath)).toBe(true);

      const installedResult = Bun.spawnSync([installedPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(installedResult.exitCode).toBe(0);
      expect(new TextDecoder().decode(installedResult.stdout).trim()).toBe("wfm test binary");
    } finally {
      await server.stop(true);
    }
  });

  it("fails with a clear error on unsupported platforms", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const result = await runInstallScript({
      ...process.env,
      PATH: process.env.PATH ?? "",
      WORKFLOW_MANAGER_INSTALL_DIR: installDir,
      WORKFLOW_MANAGER_INSTALL_OS: "plan9",
      WORKFLOW_MANAGER_INSTALL_ARCH: "amd64",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsupported operating system: plan9");
  });
});

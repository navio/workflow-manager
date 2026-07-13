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

async function runShellCommand(command: string, env: NodeJS.ProcessEnv): Promise<ScriptRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-ic", command], {
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
      expect(result.stdout).toContain("Installed workflow-manager alias");

      const installedPath = path.join(installDir, "wfm");
      const aliasPath = path.join(installDir, "workflow-manager");
      expect(fs.existsSync(installedPath)).toBe(true);
      expect(fs.existsSync(aliasPath)).toBe(true);

      const installedResult = Bun.spawnSync([installedPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(installedResult.exitCode).toBe(0);
      expect(new TextDecoder().decode(installedResult.stdout).trim()).toBe("wfm test binary");

      const aliasResult = Bun.spawnSync([aliasPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(aliasResult.exitCode).toBe(0);
      expect(new TextDecoder().decode(aliasResult.stdout).trim()).toBe("wfm test binary");
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

  it("adds the install directory to bash profile when PATH is missing it", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const homeDir = makeTempDir("wm-install-home-");
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
        HOME: homeDir,
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
        WORKFLOW_MANAGER_INSTALL_BASE_URL: `http://127.0.0.1:${server.port}`,
        WORKFLOW_MANAGER_INSTALL_DIR: installDir,
        WORKFLOW_MANAGER_INSTALL_OS: "linux",
        WORKFLOW_MANAGER_INSTALL_ARCH: "x86_64",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Added ${installDir} to PATH in ${path.join(homeDir, ".bashrc")}.`);

      const bashrc = path.join(homeDir, ".bashrc");
      expect(fs.readFileSync(bashrc, "utf-8")).toContain(`export PATH="${installDir}:$PATH"`);

      const shellResult = await runShellCommand("command -v wfm", {
        ...process.env,
        HOME: homeDir,
        PATH: "/usr/bin:/bin",
      });

      expect(shellResult.status).toBe(0);
      expect(shellResult.stdout.trim()).toBe(path.join(installDir, "wfm"));
    } finally {
      await server.stop(true);
    }
  });

  it("prints a manual PATH hint when shell profile setup is disabled", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const homeDir = makeTempDir("wm-install-home-");
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
        HOME: homeDir,
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
        WORKFLOW_MANAGER_INSTALL_BASE_URL: `http://127.0.0.1:${server.port}`,
        WORKFLOW_MANAGER_INSTALL_DIR: installDir,
        WORKFLOW_MANAGER_INSTALL_OS: "linux",
        WORKFLOW_MANAGER_INSTALL_ARCH: "x86_64",
        WORKFLOW_MANAGER_INSTALL_SKIP_SHELL_SETUP: "1",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Add ${installDir} to PATH to run \`wfm\` from any shell.`);
      expect(fs.existsSync(path.join(homeDir, ".bashrc"))).toBe(false);
    } finally {
      await server.stop(true);
    }
  });

  it("resolves the download version from the npm registry when no version or base URL is pinned", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const npmRegistryServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ name: "@workflow-manager/runner", version: "9.9.9" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    try {
      const result = await runInstallScript({
        ...process.env,
        PATH: process.env.PATH ?? "",
        WORKFLOW_MANAGER_INSTALL_NPM_REGISTRY: `http://127.0.0.1:${npmRegistryServer.port}/`,
        WORKFLOW_MANAGER_INSTALL_DIR: installDir,
        WORKFLOW_MANAGER_INSTALL_OS: "linux",
        WORKFLOW_MANAGER_INSTALL_ARCH: "x86_64",
      });

      expect(result.stdout).toContain(
        "Downloading wfm from https://github.com/navio/workflow-manager/releases/download/v9.9.9/wfm-linux-x64",
      );
      expect(result.stderr).not.toContain("could not resolve latest version from npm");
    } finally {
      await npmRegistryServer.stop(true);
    }
  });

  it("falls back to the GitHub latest release when the npm registry lookup fails", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const npmRegistryServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response("internal error", { status: 500 });
      },
    });

    try {
      const result = await runInstallScript({
        ...process.env,
        PATH: process.env.PATH ?? "",
        WORKFLOW_MANAGER_INSTALL_NPM_REGISTRY: `http://127.0.0.1:${npmRegistryServer.port}/`,
        WORKFLOW_MANAGER_INSTALL_DIR: installDir,
        WORKFLOW_MANAGER_INSTALL_OS: "linux",
        WORKFLOW_MANAGER_INSTALL_ARCH: "x86_64",
      });

      expect(result.stderr).toContain(
        "warning: could not resolve latest version from npm; falling back to GitHub latest release",
      );
      expect(result.stdout).toContain(
        "Downloading wfm from https://github.com/navio/workflow-manager/releases/latest/download/wfm-linux-x64",
      );
    } finally {
      await npmRegistryServer.stop(true);
    }
  });

  it("skips the npm registry lookup when a version is explicitly pinned", async () => {
    const installDir = makeTempDir("wm-install-dir-");
    const npmRegistryServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ name: "@workflow-manager/runner", version: "9.9.9" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    try {
      const result = await runInstallScript({
        ...process.env,
        PATH: process.env.PATH ?? "",
        WORKFLOW_MANAGER_INSTALL_VERSION: "v1.2.3",
        WORKFLOW_MANAGER_INSTALL_NPM_REGISTRY: `http://127.0.0.1:${npmRegistryServer.port}/`,
        WORKFLOW_MANAGER_INSTALL_DIR: installDir,
        WORKFLOW_MANAGER_INSTALL_OS: "linux",
        WORKFLOW_MANAGER_INSTALL_ARCH: "x86_64",
      });

      expect(result.stdout).toContain(
        "Downloading wfm from https://github.com/navio/workflow-manager/releases/download/v1.2.3/wfm-linux-x64",
      );
      expect(result.stdout).not.toContain("v9.9.9");
    } finally {
      await npmRegistryServer.stop(true);
    }
  });
});

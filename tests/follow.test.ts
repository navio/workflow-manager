import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openFollowTab, replayRunArchive } from "../src/follow.ts";

interface CommandCall {
  command: string;
  args: string[];
}

function archiveFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-follow-"));
  const archivePath = path.join(directory, "run.jsonl");
  fs.writeFileSync(
    archivePath,
    `${JSON.stringify({
      type: "event",
      occurredAt: "2026-09-15T12:00:01.000Z",
      data: {
        type: "agent.stdout",
        stepKey: "plan",
        payload: { text: "planning\n", adapter: "pi-agent" },
      },
    })}\n`,
    "utf-8"
  );
  return archivePath;
}

describe("follow", () => {
  it("replays archived agent output with an optional step filter", () => {
    const archivePath = archiveFile();
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      expect(replayRunArchive(archivePath, { output: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) } })).toBe(0);
      expect(stdout).toEqual(["planning\n"]);
      expect(stderr).toEqual([]);

      expect(
        replayRunArchive(archivePath, {
          stepKey: "review",
          output: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
        })
      ).toBe(0);
      expect(stdout).toEqual(["planning\n"]);
    } finally {
      fs.rmSync(path.dirname(archivePath), { recursive: true, force: true });
    }
  });

  it("opens a Herdr tab without exposing the attach token", () => {
    const calls: CommandCall[] = [];
    const error = openFollowTab({
      sessionFilePath: "/tmp/session file.json",
      stepKey: "plan",
      cwd: "/tmp/project",
      commandName: "wfm",
      env: { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w1" },
      runCommand: (command, args) => {
        calls.push({ command, args });
        return {
          status: 0,
          stdout: command === "herdr" && args[1] === "create" ? JSON.stringify({ result: { root_pane: { pane_id: "w1:p2" } } }) : "",
        };
      },
    });

    expect(error).toBeNull();
    expect(calls[0]).toEqual({
      command: "herdr",
      args: ["tab", "create", "--workspace", "w1", "--cwd", "/tmp/project", "--label", "wfm follow", "--no-focus"],
    });
    expect(calls[1]?.command).toBe("herdr");
    expect(calls[1]?.args.slice(0, 3)).toEqual(["pane", "run", "w1:p2"]);
    expect(calls[1]?.args[3]).toContain("follow");
    expect(calls[1]?.args[3]).not.toContain("attachToken");
  });

  it("opens a tmux window when Herdr is unavailable", () => {
    const calls: CommandCall[] = [];
    const error = openFollowTab({
      sessionFilePath: "/tmp/session.json",
      cwd: "/tmp/project",
      commandName: "wfm",
      env: { TMUX: "/tmp/tmux-1/default,1,0" },
      runCommand: (command, args) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    });

    expect(error).toBeNull();
    expect(calls).toEqual([
      {
        command: "tmux",
        args: ["new-window", "-d", "-n", "wfm-follow", "-c", "/tmp/project", "'wfm' 'follow' '--session-file' '/tmp/session.json'"],
      },
    ]);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionFile, writeSessionFile } from "../src/sessionFile.ts";
import type { RunnerSessionFile } from "../src/sessionFile.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-session-file-"));
  tempDirs.push(dir);
  return dir;
}

function sampleSession(): RunnerSessionFile {
  return {
    baseUrl: "http://127.0.0.1:43121",
    attachToken: "token-123",
    runId: "run-abc",
    pid: 4242,
    startedAt: "2026-07-10T10:00:00.000Z",
  };
}

describe("session file helpers", () => {
  it("round-trips a session through write and read", () => {
    const filePath = path.join(tempDir(), "session.json");
    const session = sampleSession();

    writeSessionFile(filePath, session);
    expect(readSessionFile(filePath)).toEqual(session);
  });

  it("round-trips endedAt and status", () => {
    const filePath = path.join(tempDir(), "session.json");
    const session: RunnerSessionFile = {
      ...sampleSession(),
      endedAt: "2026-07-10T10:05:00.000Z",
      status: "succeeded",
    };

    writeSessionFile(filePath, session);
    expect(readSessionFile(filePath)).toEqual(session);
  });

  it("writes the file with mode 0600 and creates parent directories", () => {
    const filePath = path.join(tempDir(), "nested", "deeper", "session.json");

    writeSessionFile(filePath, sampleSession());

    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("keeps mode 0600 when rewriting an existing file", () => {
    const filePath = path.join(tempDir(), "session.json");
    fs.writeFileSync(filePath, "{}", { encoding: "utf-8", mode: 0o644 });

    writeSessionFile(filePath, { ...sampleSession(), endedAt: "2026-07-10T10:05:00.000Z", status: "failed" });

    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns an error string for a missing file", () => {
    const filePath = path.join(tempDir(), "missing.json");

    const result = readSessionFile(filePath);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Could not read session file");
  });

  it("returns an error string for corrupt JSON", () => {
    const filePath = path.join(tempDir(), "corrupt.json");
    fs.writeFileSync(filePath, "{not json", "utf-8");

    const result = readSessionFile(filePath);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("is not valid JSON");
  });

  it("returns an error string for non-object JSON", () => {
    const filePath = path.join(tempDir(), "array.json");
    fs.writeFileSync(filePath, "[1,2,3]", "utf-8");

    const result = readSessionFile(filePath);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("must contain a JSON object");
  });

  it("returns an error string when required fields are missing or invalid", () => {
    const dir = tempDir();

    const missingToken = path.join(dir, "missing-token.json");
    const { attachToken: _attachToken, ...withoutToken } = sampleSession();
    fs.writeFileSync(missingToken, JSON.stringify(withoutToken), "utf-8");
    expect(readSessionFile(missingToken) as string).toContain("missing required field: attachToken");

    const badPid = path.join(dir, "bad-pid.json");
    fs.writeFileSync(badPid, JSON.stringify({ ...sampleSession(), pid: "4242" }), "utf-8");
    expect(readSessionFile(badPid) as string).toContain("missing required field: pid");
  });
});

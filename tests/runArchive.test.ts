import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRunArchive, defaultRunArchiveDirectory, readRunArchive } from "../src/runArchive.ts";
import type { RunEvent, RunSnapshot, WorkflowDefinition } from "../src/types.ts";

function workflow(): WorkflowDefinition {
  return { key: "archive-demo", title: "Archive Demo", steps: [] };
}

function snapshot(): RunSnapshot {
  return {
    runId: "run-archive",
    workflowKey: "archive-demo",
    workflowTitle: "Archive Demo",
    status: "running",
    currentStepKey: "plan",
    startedAt: "2026-09-15T12:00:00.000Z",
    updatedAt: "2026-09-15T12:00:01.000Z",
    endedAt: null,
    objective: "Archive output",
    objectives: [],
    waitingForApproval: null,
    steps: [],
  };
}

describe("run archive", () => {
  it("defaults to the project-local .wfm/runs directory", () => {
    expect(defaultRunArchiveDirectory()).toBe(path.join(process.cwd(), ".wfm", "runs"));
  });
  it("persists metadata, agent output, and snapshots with owner-only permissions", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-run-archive-"));
    try {
      const archive = createRunArchive(workflow(), "run-archive", directory);
      const event: RunEvent = {
        id: "event-1",
        runId: "run-archive",
        stepRunId: "plan",
        type: "agent.stderr",
        sequenceNumber: 1,
        occurredAt: "2026-09-15T12:00:01.000Z",
        actor: "agent",
        payload: { stream: "stderr", text: "failed to compile\n", adapter: "codex" },
      };
      archive.onEvent(event);
      archive.onSnapshot(snapshot(), []);

      expect(fs.statSync(archive.path).mode & 0o777).toBe(0o600);
      const records = readRunArchive(archive.path);
      expect(typeof records).not.toBe("string");
      if (typeof records === "string") throw new Error(records);
      expect(records).toHaveLength(3);
      expect(records[0]?.data.workflowKey).toBe("archive-demo");
      expect(records[1]?.data.payload).toEqual(event.payload);
      expect(records[2]?.data.snapshot).toEqual(snapshot());
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import type { RunEvent, RunObserver, RunSnapshot, StepDetailSnapshot, WorkflowDefinition } from "./types.js";

export interface RunArchiveInfo {
  path: string;
  runId: string;
}

export interface ArchiveRecord {
  type: "metadata" | "event" | "snapshot";
  occurredAt: string;
  data: Record<string, unknown>;
}

function appendRecord(filePath: string, record: ArchiveRecord): void {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf-8", mode: 0o600 });
}

export function defaultRunArchiveDirectory(): string {
  return path.join(process.cwd(), ".wfm", "runs");
}

export function createRunArchive(
  workflow: WorkflowDefinition,
  runId: string,
  directory = defaultRunArchiveDirectory()
): RunArchive & RunArchiveInfo {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const archivePath = path.join(directory, `${runId}.jsonl`);
  fs.writeFileSync(archivePath, "", { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(archivePath, 0o600);

  const archive = new RunArchive(archivePath);
  archive.writeMetadata(workflow, runId);
  return Object.assign(archive, { path: archivePath, runId });
}

export class RunArchive implements RunObserver {
  constructor(readonly path: string) {}

  writeMetadata(workflow: WorkflowDefinition, runId: string): void {
    appendRecord(this.path, {
      type: "metadata",
      occurredAt: new Date().toISOString(),
      data: {
        runId,
        workflowKey: workflow.key,
        workflowTitle: workflow.title,
      },
    });
  }

  onEvent(event: RunEvent): void {
    appendRecord(this.path, {
      type: "event",
      occurredAt: event.occurredAt,
      data: {
        id: event.id,
        sequence: event.sequenceNumber,
        type: event.type,
        runId: event.runId,
        stepKey: event.stepRunId,
        actor: event.actor,
        payload: event.payload,
      },
    });
  }

  onSnapshot(snapshot: RunSnapshot, stepDetails: StepDetailSnapshot[]): void {
    appendRecord(this.path, {
      type: "snapshot",
      occurredAt: snapshot.updatedAt ?? new Date().toISOString(),
      data: {
        snapshot,
        stepDetails,
      },
    });
  }

  onLog(): void {}
}

export function readRunArchive(filePath: string): ArchiveRecord[] | string {
  const resolvedPath = path.resolve(filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    return `Could not read run archive ${resolvedPath}: ${(error as Error).message}`;
  }

  const records: ArchiveRecord[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return `Run archive ${resolvedPath} has an invalid record on line ${index + 1}`;
      }
      const record = parsed as Record<string, unknown>;
      if (
        (record.type !== "metadata" && record.type !== "event" && record.type !== "snapshot") ||
        typeof record.occurredAt !== "string" ||
        !record.data ||
        typeof record.data !== "object" ||
        Array.isArray(record.data)
      ) {
        return `Run archive ${resolvedPath} has an invalid record on line ${index + 1}`;
      }
      records.push({
        type: record.type,
        occurredAt: record.occurredAt,
        data: record.data as Record<string, unknown>,
      });
    } catch {
      return `Run archive ${resolvedPath} is not valid JSONL (line ${index + 1})`;
    }
  }
  return records;
}

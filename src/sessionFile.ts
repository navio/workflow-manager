import fs from "node:fs";
import path from "node:path";

export interface RunnerSessionFile {
  baseUrl: string;
  attachToken: string;
  runId: string;
  pid: number;
  startedAt: string;
  endedAt?: string;
  status?: string;
}

export function writeSessionFile(filePath: string, session: RunnerSessionFile): void {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  // writeFileSync only applies the mode on creation; enforce it on rewrites too.
  fs.chmodSync(resolvedPath, 0o600);
}

export function readSessionFile(filePath: string): RunnerSessionFile | string {
  const resolvedPath = path.resolve(filePath);

  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    return `Could not read session file ${resolvedPath}: ${(error as Error).message}`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `Session file ${resolvedPath} is not valid JSON`;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `Session file ${resolvedPath} must contain a JSON object`;
  }

  const record = parsed as Record<string, unknown>;
  for (const field of ["baseUrl", "attachToken", "runId", "startedAt"] as const) {
    if (typeof record[field] !== "string" || record[field] === "") {
      return `Session file ${resolvedPath} is missing required field: ${field}`;
    }
  }
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid)) {
    return `Session file ${resolvedPath} is missing required field: pid`;
  }
  if (record.endedAt !== undefined && typeof record.endedAt !== "string") {
    return `Session file ${resolvedPath} has an invalid endedAt field`;
  }
  if (record.status !== undefined && typeof record.status !== "string") {
    return `Session file ${resolvedPath} has an invalid status field`;
  }

  const session: RunnerSessionFile = {
    baseUrl: record.baseUrl as string,
    attachToken: record.attachToken as string,
    runId: record.runId as string,
    pid: record.pid,
    startedAt: record.startedAt as string,
  };
  if (typeof record.endedAt === "string") {
    session.endedAt = record.endedAt;
  }
  if (typeof record.status === "string") {
    session.status = record.status;
  }
  return session;
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { readRunArchive } from "./runArchive.js";

export interface FollowConnection {
  baseUrl: string;
  token: string;
  runId?: string;
}

interface FollowEvent {
  type: string;
  occurredAt: string;
  stepKey?: string;
  data: Record<string, unknown>;
}

interface FollowOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface CommandResult {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
}

type CommandRunner = (command: string, args: string[], options: { encoding: "utf-8" }) => CommandResult;

export interface OpenFollowTabOptions {
  sessionFilePath: string;
  stepKey?: string;
  cwd: string;
  commandName: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: CommandRunner;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function textValue(value: string | Buffer | undefined): string {
  return typeof value === "string" ? value : value?.toString("utf-8") ?? "";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function followCommand(commandName: string, sessionFilePath: string, stepKey?: string): string {
  const args = [commandName, "follow", "--session-file", path.resolve(sessionFilePath)];
  if (stepKey) args.push("--step", stepKey);
  return args.map(shellQuote).join(" ");
}

function commandFailure(command: string, result: CommandResult): string {
  const detail = result.error?.message ?? (textValue(result.stderr).trim() || `exited with status ${result.status ?? "unknown"}`);
  return `${command} failed: ${detail}`;
}

function herdrPaneId(output: string): string | null {
  try {
    const parsed = asRecord(JSON.parse(output));
    const result = asRecord(parsed?.result) ?? parsed;
    const rootPane = asRecord(result?.root_pane);
    return stringValue(rootPane?.pane_id) ?? null;
  } catch {
    return null;
  }
}

export function openFollowTab(options: OpenFollowTabOptions): string | null {
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  const command = followCommand(options.commandName, options.sessionFilePath, options.stepKey);

  if (env.HERDR_ENV === "1") {
    const workspaceId = stringValue(env.HERDR_WORKSPACE_ID);
    if (!workspaceId) {
      return "Cannot open a follow tab: HERDR_WORKSPACE_ID is not set.";
    }
    const create = runCommand(
      "herdr",
      ["tab", "create", "--workspace", workspaceId, "--cwd", options.cwd, "--label", "wfm follow", "--no-focus"],
      { encoding: "utf-8" }
    );
    if (create.status !== 0) {
      return commandFailure("herdr tab create", create);
    }
    const paneId = herdrPaneId(textValue(create.stdout));
    if (!paneId) {
      return "herdr tab create did not return a root pane id.";
    }
    const start = runCommand("herdr", ["pane", "run", paneId, command], { encoding: "utf-8" });
    if (start.status !== 0) {
      return commandFailure("herdr pane run", start);
    }
    return null;
  }

  if (env.TMUX) {
    const result = runCommand(
      "tmux",
      ["new-window", "-d", "-n", "wfm-follow", "-c", options.cwd, command],
      { encoding: "utf-8" }
    );
    return result.status === 0 ? null : commandFailure("tmux new-window", result);
  }

  return "Cannot open a follow tab: start wfm inside Herdr or tmux, or run wfm follow in another terminal.";
}

function eventFromUnknown(value: unknown): FollowEvent | null {
  const record = asRecord(value);
  if (!record) return null;
  const type = stringValue(record.type);
  const occurredAt = stringValue(record.occurredAt);
  const data = asRecord(record.data);
  if (!type || !occurredAt || !data) return null;
  return {
    type,
    occurredAt,
    stepKey: stringValue(record.stepKey),
    data,
  };
}

function writeEvent(event: FollowEvent, output: FollowOutput, stepKey?: string): void {
  if (stepKey && event.stepKey !== stepKey) return;
  const text = stringValue(event.data.text);
  if (event.type === "agent.stdout" && text) {
    output.stdout(text);
    return;
  }
  if (event.type === "agent.stderr" && text) {
    output.stderr(text);
    return;
  }

  const timestamp = event.occurredAt.replace("T", " ").replace(".000Z", "Z");
  const step = event.stepKey ? ` ${event.stepKey}` : "";
  const adapter = stringValue(event.data.adapter);
  const command = stringValue(event.data.command);
  const details = [adapter, command].filter(Boolean).join(" · ");
  output.stderr(`[${timestamp}]${step} ${event.type}${details ? ` (${details})` : ""}\n`);
}

async function resolveRunId(connection: FollowConnection): Promise<{ runId?: string; error?: string }> {
  if (connection.runId) return { runId: connection.runId };
  const response = await fetch(`${connection.baseUrl}/session`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  if (!response.ok) {
    return { error: `Could not determine run id: ${await response.text()}` };
  }
  const session = asRecord(await response.json());
  const run = asRecord(session?.run);
  const runId = stringValue(run?.runId);
  return runId ? { runId } : { error: "Could not determine run id. Pass --run-id explicitly." };
}

function sseData(frame: string): unknown | null {
  const lines = frame.replace(/\r/g, "").split("\n");
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export async function followRun(
  connection: FollowConnection,
  options: { stepKey?: string; output?: FollowOutput } = {}
): Promise<number> {
  const output = options.output ?? {
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text),
  };
  let runId: string;
  try {
    const resolved = await resolveRunId(connection);
    if (!resolved.runId) {
      output.stderr(`${resolved.error ?? "Could not determine run id."}\n`);
      return 1;
    }
    runId = resolved.runId;
    const response = await fetch(`${connection.baseUrl}/runs/${encodeURIComponent(runId)}/events`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    if (!response.ok || !response.body) {
      output.stderr(`follow failed: ${await response.text()}\n`);
      return 1;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let separator = pending.indexOf("\n\n");
      while (separator >= 0) {
        const frame = pending.slice(0, separator);
        pending = pending.slice(separator + 2);
        const event = eventFromUnknown(sseData(frame));
        if (event) writeEvent(event, output, options.stepKey);
        separator = pending.indexOf("\n\n");
      }
      if (done) break;
    }
    return 0;
  } catch (error) {
    output.stderr(`follow failed: ${(error as Error).message}\n`);
    return 1;
  }
}

export function replayRunArchive(filePath: string, options: { stepKey?: string; output?: FollowOutput } = {}): number {
  const output = options.output ?? {
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text),
  };
  const records = readRunArchive(filePath);
  if (typeof records === "string") {
    output.stderr(`${records}\n`);
    return 1;
  }
  for (const record of records) {
    if (record.type !== "event") continue;
    const event = eventFromUnknown({
      type: record.data.type,
      occurredAt: record.occurredAt,
      stepKey: record.data.stepKey,
      data: record.data.payload,
    });
    if (event) writeEvent(event, output, options.stepKey);
  }
  return 0;
}

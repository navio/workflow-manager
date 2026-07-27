import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  type McpServer,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { resolveTaskAdapter } from "./adapters.js";
import { type ContextMetrics, createContextMetricsBuilder } from "./contextMetrics.js";
import { resolveSkill } from "./skillResolver.js";
import type {
  AdapterKey,
  InputEnvelope,
  OutputEnvelope,
  StepDefinition,
  StepExecutionHooks,
  WorkflowDefinition,
} from "./types.js";

type PermissionPolicy = "allow" | "deny" | "reads-only";

interface ResolvedAcpCommand {
  command: string;
  args: string[];
}

// Presets so claude-code / opencode / codex / a named agent route through ACP without
// an explicit command. Verified invocations (gemini --experimental-acp and opencode acp
// confirmed against gemini 0.31 / opencode 1.2; claude-code-acp is the @zed-industries
// bridge — `claude` itself has no native ACP; codex-acp is the @agentclientprotocol
// bridge — `codex` itself has no native ACP, handshake confirmed against codex-acp 1.1).
// All overridable via payload.acpCommand / acpArgs or WFM_ACP_COMMAND.
const ACP_COMMAND_PRESETS: Record<string, ResolvedAcpCommand> = {
  "claude-code": { command: "claude-code-acp", args: [] },
  opencode: { command: "opencode", args: ["acp"] },
  gemini: { command: "gemini", args: ["--experimental-acp"] },
  codex: { command: "codex-acp", args: [] },
};

const READ_ONLY_TOOL_KINDS = new Set(["read", "search", "fetch", "think"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// node:stream's Writable.toWeb / Readable.toWeb are not implemented in Bun, so we
// bridge the child process stdio to Web streams ourselves (portable across runtimes).
function writableToWeb(writable: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        writable.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    },
    close() {
      return new Promise((resolve) => writable.end(() => resolve()));
    },
    abort() {
      writable.destroy();
    },
  });
}

function readableToWeb(readable: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      readable.on("data", (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk));
      });
      readable.on("end", () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      readable.on("error", (err: Error) => controller.error(err));
    },
    cancel() {
      readable.destroy();
    },
  });
}

export function normalizeTimeout(value: unknown, fallbackMs = 600000): number {
  const timeout = Number(value ?? fallbackMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return fallbackMs;
  return Math.floor(timeout);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resolves which ACP agent command to launch for a step. Precedence:
 * payload.acpCommand → WFM_ACP_COMMAND env → preset for payload.acpAgent → preset
 * for the adapter key (claude-code / opencode / codex). Returns null when nothing
 * resolves (e.g. bare `acp` without configuration), which keeps the step on mock.
 */
export function resolveAcpCommand(step: StepDefinition, env: NodeJS.ProcessEnv): ResolvedAcpCommand | null {
  const payload = asRecord(step.taskSpec?.payload);
  const payloadArgs = Array.isArray(payload.acpArgs) ? payload.acpArgs.map((arg) => String(arg)) : [];

  const explicit = stringArg(payload.acpCommand) ?? stringArg(env.WFM_ACP_COMMAND);
  if (explicit) {
    return { command: explicit, args: payloadArgs };
  }

  const presetKey = stringArg(payload.acpAgent) ?? resolveTaskAdapter(step.taskSpec?.adapterKey);
  const preset = ACP_COMMAND_PRESETS[presetKey];
  if (preset) {
    return { command: preset.command, args: payloadArgs.length > 0 ? payloadArgs : [...preset.args] };
  }

  return null;
}

// Adapters that run real through ACP by default. Everything else opts in with
// payload.useRealAdapter: true; these opt OUT with payload.useRealAdapter: false.
const REAL_BY_DEFAULT_ACP_ADAPTERS: ReadonlySet<AdapterKey> = new Set(["opencode"]);

export function isRealByDefaultAcpAdapter(adapter: AdapterKey): boolean {
  return REAL_BY_DEFAULT_ACP_ADAPTERS.has(adapter);
}

export function shouldUseRealAcp(step: StepDefinition): boolean {
  const payload = asRecord(step.taskSpec?.payload);
  const adapter = resolveTaskAdapter(step.taskSpec?.adapterKey);
  const realEnabled = isRealByDefaultAcpAdapter(adapter)
    ? payload.useRealAdapter !== false
    : payload.useRealAdapter === true;
  return realEnabled && resolveAcpCommand(step, process.env) !== null;
}

function permissionPolicy(step: StepDefinition): PermissionPolicy {
  const value = asRecord(step.taskSpec?.payload).acpPermissions;
  return value === "deny" || value === "reads-only" ? value : "allow";
}

function decidePermission(req: RequestPermissionRequest, policy: PermissionPolicy): RequestPermissionResponse {
  const allow =
    req.options.find((option) => option.kind === "allow_once") ??
    req.options.find((option) => option.kind === "allow_always");
  const reject =
    req.options.find((option) => option.kind === "reject_once") ??
    req.options.find((option) => option.kind === "reject_always");

  let chooseAllow: boolean;
  if (policy === "allow") {
    chooseAllow = true;
  } else if (policy === "deny") {
    chooseAllow = false;
  } else {
    const kind = req.toolCall.kind ?? undefined;
    chooseAllow = kind ? READ_ONLY_TOOL_KINDS.has(kind) : false;
  }

  const chosen = chooseAllow ? (allow ?? req.options[0]) : reject;
  if (!chosen) {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: chosen.optionId } };
}

function buildMcpServers(endpoints: string[]): { servers: McpServer[]; skipped: string[] } {
  const servers: McpServer[] = [];
  const skipped: string[] = [];
  for (const endpoint of endpoints) {
    if (/^https?:\/\//i.test(endpoint)) {
      servers.push({ type: "http", name: endpoint, url: endpoint, headers: [] });
    } else {
      skipped.push(endpoint);
    }
  }
  return { servers, skipped };
}

function composePrompt(
  step: StepDefinition,
  input: InputEnvelope,
  workflow?: WorkflowDefinition,
  workflowFilePath?: string
): { prompt: string; metrics: ContextMetrics } {
  const payload = asRecord(step.taskSpec?.payload);
  const metrics = createContextMetricsBuilder();

  if (typeof payload.prompt === "string" && payload.prompt.trim()) {
    metrics.addContext(payload.prompt);
    return { prompt: payload.prompt, metrics: metrics.build() };
  }

  const parts: string[] = [];

  const systemPrompts = input.priming_configuration.system_prompts;
  if (systemPrompts.length > 0) {
    const joined = systemPrompts.join("\n");
    parts.push(joined);
    metrics.addSystemPrompts(joined);
  }

  const skills = input.priming_configuration.required_skills;
  if (skills.length > 0) {
    const unresolved: string[] = [];
    for (const name of skills) {
      const resolved = workflow && workflowFilePath ? resolveSkill(name, workflow, workflowFilePath) : null;
      if (resolved) {
        parts.push(resolved.content);
        metrics.addSkill(name, resolved.content);
      } else {
        unresolved.push(name);
      }
    }
    if (unresolved.length > 0) {
      parts.push(`Apply the following skills: ${unresolved.join(", ")}`);
    }
  }

  const globalState = input.global_context.global_state;
  const inputLines = Object.entries(globalState)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${String(value).replace(/[\n\r]/g, " ")}`);
  if (inputLines.length > 0) {
    const block = `Input:\n${inputLines.join("\n")}`;
    parts.push(block);
    metrics.addGlobalState(block);
  }

  parts.push(input.step_context.step_objective);
  metrics.addObjective(input.step_context.step_objective);

  const previous = input.step_context.previous_output;
  if (Object.keys(previous).length > 0) {
    const block = `Previous step output:\n${JSON.stringify(previous, null, 2)}`;
    parts.push(block);
    metrics.addPreviousOutput(block);
  }

  const context = input.priming_configuration.context;
  if (typeof context === "string" && context.trim()) {
    const block = `Context:\n${context}`;
    parts.push(block);
    metrics.addContext(block);
  } else if (context && typeof context === "object") {
    const serialized = JSON.stringify(context, null, 2);
    if (serialized !== "{}") {
      const block = `Context:\n${serialized}`;
      parts.push(block);
      metrics.addContext(block);
    }
  }

  return { prompt: parts.join("\n\n"), metrics: metrics.build() };
}

function mapStopReason(
  stopReason: string
): { status: OutputEnvelope["execution_status"]; action: OutputEnvelope["qa_routing"]["action"]; reason: string } {
  switch (stopReason) {
    case "end_turn":
      return { status: "SUCCESS", action: "PROCEED", reason: "" };
    case "refusal":
      return { status: "QA_REJECTED", action: "RETRY_CURRENT", reason: "agent refused the turn" };
    case "max_tokens":
      return { status: "FAILED", action: "RETRY_CURRENT", reason: "agent stopped at max tokens" };
    case "max_turn_requests":
      return { status: "FAILED", action: "RETRY_CURRENT", reason: "agent stopped at max turn requests" };
    case "cancelled":
      return { status: "FAILED", action: "PROCEED", reason: "turn cancelled" };
    default:
      return { status: "FAILED", action: "PROCEED", reason: `unknown stop reason: ${stopReason}` };
  }
}

export function executeAcpStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  workflow?: WorkflowDefinition,
  workflowFilePath?: string,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  const startedAt = Date.now();
  const adapter = resolveTaskAdapter(step.taskSpec?.adapterKey);
  const payload = asRecord(step.taskSpec?.payload);
  const timeoutMs = normalizeTimeout(payload.timeoutMs);
  const resolved = resolveAcpCommand(step, process.env);

  const makeResult = (
    status: OutputEnvelope["execution_status"],
    reason: string,
    extra: Record<string, unknown> = {},
    action: OutputEnvelope["qa_routing"]["action"] = "PROCEED"
  ): OutputEnvelope => ({
    step_id: step.key,
    execution_status: status,
    qa_routing: { action, feedback_reason: reason },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter,
      command: resolved?.command,
      args: resolved?.args,
      ...extra,
    },
    metadata: {
      execution_time_ms: Date.now() - startedAt,
      external_intervention_required: false,
    },
  });

  if (!resolved) {
    return Promise.resolve(makeResult("FAILED", "no ACP agent command could be resolved for this step"));
  }

  const cwd = stringArg(payload.cwd) ?? (workflowFilePath ? path.dirname(path.resolve(workflowFilePath)) : process.cwd());
  const policy = permissionPolicy(step);
  const { servers: mcpServers, skipped } = buildMcpServers(input.priming_configuration.mcp_endpoints);
  if (skipped.length > 0) {
    hooks?.onStderr?.(`[acp] ignoring non-http MCP endpoints (need structured config): ${skipped.join(", ")}\n`);
  }
  const { prompt: promptText, metrics: contextMetrics } = composePrompt(step, input, workflow, workflowFilePath);

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(resolved.command, resolved.args, { stdio: ["pipe", "pipe", "pipe"], cwd, env: process.env });
  } catch (err) {
    return Promise.resolve(makeResult("FAILED", `failed to spawn ${resolved.command}: ${(err as Error).message}`));
  }

  hooks?.onStarted?.({ command: resolved.command, args: resolved.args, cwd, timeoutMs, contextMetrics });
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (chunk: string) => hooks?.onStderr?.(chunk));

  // A ChildProcess "error" (e.g. ENOENT for a missing agent binary) is emitted
  // asynchronously and would crash the process if unhandled.
  const childError = new Promise<OutputEnvelope>((_resolve, reject) => {
    child.on("error", (err) => reject(new Error(`agent process error: ${err.message}`)));
  });

  let agentText = "";
  let sessionId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const client: Client = {
    async sessionUpdate(params) {
      const update = params.update;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        agentText += update.content.text;
        hooks?.onStdout?.(update.content.text);
      } else if (update.sessionUpdate === "tool_call") {
        hooks?.onStdout?.(`\n[acp tool] ${update.title}\n`);
      }
    },
    async requestPermission(params) {
      return decidePermission(params, policy);
    },
    async readTextFile(params) {
      return { content: fs.readFileSync(params.path, "utf-8") };
    },
    async writeTextFile(params) {
      fs.mkdirSync(path.dirname(params.path), { recursive: true });
      fs.writeFileSync(params.path, params.content, "utf-8");
      return {};
    },
  };

  let conn: ClientSideConnection;
  try {
    const stream = ndJsonStream(writableToWeb(child.stdin!), readableToWeb(child.stdout!));
    conn = new ClientSideConnection(() => client, stream);
  } catch (err) {
    child.kill("SIGKILL");
    return Promise.resolve(makeResult("FAILED", `failed to open ACP connection: ${(err as Error).message}`));
  }

  const runTurn = async (): Promise<OutputEnvelope> => {
    await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    const authMethod = stringArg(payload.acpAuthMethod) ?? stringArg(process.env.WFM_ACP_AUTH_METHOD);
    if (authMethod) {
      await conn.authenticate({ methodId: authMethod });
    }

    const session = await conn.newSession({ cwd, mcpServers });
    sessionId = session.sessionId;

    const prompt: ContentBlock[] = [{ type: "text", text: promptText }];
    const response = await conn.prompt({ sessionId: session.sessionId, prompt });

    const mapped = mapStopReason(response.stopReason);
    return makeResult(
      mapped.status,
      mapped.reason,
      { stopReason: response.stopReason, output: agentText.trim(), prompt: promptText, contextMetrics },
      mapped.action
    );
  };

  const timeout = new Promise<OutputEnvelope>((resolve) => {
    timer = setTimeout(() => {
      if (sessionId) {
        conn.cancel({ sessionId }).catch(() => undefined);
      }
      resolve(
        makeResult("FAILED", `timed out after ${timeoutMs}ms`, {
          stopReason: "timeout",
          output: agentText.trim(),
          prompt: promptText,
          contextMetrics,
        })
      );
    }, timeoutMs);
  });

  return Promise.race([runTurn(), timeout, childError])
    .catch((err: unknown) =>
      makeResult("FAILED", `ACP turn failed: ${(err as Error).message}`, {
        output: agentText.trim(),
        prompt: promptText,
        contextMetrics,
      })
    )
    .then((result) => {
      hooks?.onFinished?.({ executionStatus: result.execution_status });
      return result;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      child.kill("SIGTERM");
    });
}

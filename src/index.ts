#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CliRunRenderer } from "./cliRunRenderer.js";
import { startRunnerApiServer } from "./runnerApi.js";
import { RunnerSessionStore } from "./runnerSession.js";
import { parseWorkflowFile, validateWorkflow } from "./parser.js";
import { promptForApprovalDecision, runWorkflow } from "./engine.js";
import { cmdAuth, cmdPublish, cmdPull, cmdRemoteInfo, cmdSearch } from "./remote/commands.js";
import { emitRunTelemetryBestEffort } from "./remote/telemetry.js";
import type { RunObserver, StepDetailSnapshot, WorkflowDefinition } from "./types.js";

const DISCOVERY_QUESTIONS = [
  "1) What set of workflow objectives should be tracked per run (one or many)?",
  "2) Which steps require human validation vs external validation?",
  "3) Which approvals are mandatory and who can confirm each approval?",
  "4) Which steps require explicit confirmation before proceeding?",
  "5) For each step, which adapter should run it (opencode, codex, claude-code, mock)?",
  "6) What per-step initialization is needed (context, skills, MCPs, system prompts, model)?",
  "7) What output format should this session produce (JSON run report, markdown summary, event timeline)?",
  "8) What retry/rollback policy should be default and where should exceptions apply?",
];

function cliDisplayName(): string {
  const invokedAs = path.basename(process.argv[1] ?? "");
  if (invokedAs === "workflow-manager" || invokedAs === "wfm") {
    return invokedAs;
  }

  return "wfm";
}

function usage(): void {
  const cli = cliDisplayName();
  console.log(`${cli} commands:
  questions
  scaffold [path] [--format markdown|json]
  validate <workflow.md|workflow.json>
  run <workflow.md|workflow.json> [--input input.json] [--objective "string"] [--confirm stepA,stepB:human] [--auto-confirm-all] [--port 43121] [--verbose] [--json]
  approve [--url http://127.0.0.1:43121] [--token token] [--run-id run_123] [--step review] [--actor alice] [--note "LGTM"]
  resume [--url http://127.0.0.1:43121] [--token token] [--run-id run_123] [--step review] [--actor alice] [--note "continue"]
  cancel [--url http://127.0.0.1:43121] [--token token] [--run-id run_123] [--step review] [--actor alice] [--note "stop this run"]
  auth <login|whoami|logout> [--token <token>]
  publish <workflow.md|workflow.json> [--slug slug] [--title title] [--description text] [--visibility public|private] [--version version] [--tag a,b] [--draft]
  pull <owner/slug> [--version version] [--output path]
  search [query]
  remote info <owner/slug>
  man`);
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function getFlagFromArgs(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function combineRunObservers(...observers: Array<RunObserver | undefined>): RunObserver | undefined {
  const active = observers.filter((observer): observer is RunObserver => observer !== undefined);
  if (active.length === 0) {
    return undefined;
  }

  return {
    onEvent(event) {
      for (const observer of active) {
        observer.onEvent(event);
      }
    },
    onSnapshot(snapshot, stepDetails: StepDetailSnapshot[]) {
      for (const observer of active) {
        observer.onSnapshot(snapshot, stepDetails);
      }
    },
    onLog(log) {
      for (const observer of active) {
        observer.onLog(log);
      }
    },
  };
}

function cmdQuestions(): void {
  console.log("Project definition questions:");
  for (const q of DISCOVERY_QUESTIONS) console.log(`- ${q}`);
  console.log("\nExpected output of this session:");
  console.log("- Finalized workflow file (markdown or json) with per-step objectives");
  console.log("- Validation/approval confirmation map per step");
  console.log("- Adapter init map (opencode/codex/claude-code with context+skills+mcps)");
  console.log("- Runnable CLI command examples + run JSON output");
}

const WORKFLOW_SCAFFOLD_JSON: WorkflowDefinition = {
  key: "workflow-manager-sample",
  title: "Workflow Manager Sample",
  description: "Workflow definition with per-step objectives and confirmations",
  objectives: ["deliver a working implementation", "ensure validation and approvals are explicit"],
  inputSchema: {
    type: "object",
    properties: {
      ticket: { type: "string" },
    },
  },
  outputSchema: {
    type: "object",
  },
  defaultRetryPolicy: {
    maxAttempts: 2,
  },
  steps: [
    {
      key: "discover",
      kind: "task",
      objective: "Understand requirements and constraints",
      dependsOn: [],
      validation: { mode: "human", required: true, autoConfirm: false },
      taskSpec: {
        adapterKey: "opencode",
        init: {
          context: { repo: "example/repo" },
          skills: ["architecture", "planning"],
          mcps: ["mcp://github", "mcp://docs"],
          systemPrompts: ["Focus on architecture trade-offs"],
          model: "openrouter/anthropic/claude-sonnet-4",
        },
        payload: { mockResult: "success" },
      },
    },
    {
      key: "qa_gate",
      kind: "approval",
      objective: "Human product review approval",
      dependsOn: ["discover"],
      approvalSpec: {
        autoApprove: false,
        validation: { mode: "human", required: true, autoConfirm: false },
      },
    },
    {
      key: "implement",
      kind: "task",
      objective: "Implement agreed changes",
      dependsOn: ["qa_gate"],
      validation: { mode: "external", required: true, autoConfirm: false },
      retryPolicy: { maxAttempts: 2 },
      taskSpec: {
        adapterKey: "codex",
        init: {
          context: { language: "typescript" },
          skills: ["coding", "testing"],
          mcps: ["mcp://repo", "mcp://ci"],
          systemPrompts: ["Write tests with implementation"],
        },
        payload: { mockResult: "success" },
      },
    },
    {
      key: "hardening",
      kind: "task",
      objective: "Final hardening checks with Claude Code",
      dependsOn: ["implement"],
      validation: { mode: "external", required: true, autoConfirm: false },
      taskSpec: {
        adapterKey: "claude-code",
        init: {
          context: { quality: "high" },
          skills: ["security-review", "refactoring"],
          mcps: ["mcp://security"],
          systemPrompts: ["Prioritize correctness and readability"],
        },
        payload: { mockResult: "success" },
      },
    },
  ],
};

const WORKFLOW_SCAFFOLD_MARKDOWN = `---
key: workflow-manager-sample
title: Workflow Manager Sample
description: Workflow definition with per-step objectives and confirmations
objectives:
  - deliver a working implementation
  - ensure validation and approvals are explicit
inputSchema:
  type: object
  properties:
    ticket:
      type: string
outputSchema:
  type: object
defaultRetryPolicy:
  maxAttempts: 2
steps:
  - key: discover
    kind: task
    objective: Understand requirements and constraints
    dependsOn: []
    validation:
      mode: human
      required: true
      autoConfirm: false
    taskSpec:
      adapterKey: opencode
      init:
        context:
          repo: example/repo
        skills: [architecture, planning]
        mcps: [mcp://github, mcp://docs]
        systemPrompts: [Focus on architecture trade-offs]
        model: openrouter/anthropic/claude-sonnet-4
      payload:
        mockResult: success
  - key: qa_gate
    kind: approval
    objective: Human product review approval
    dependsOn: [discover]
    approvalSpec:
      autoApprove: false
      validation:
        mode: human
        required: true
        autoConfirm: false
  - key: implement
    kind: task
    objective: Implement agreed changes
    dependsOn: [qa_gate]
    validation:
      mode: external
      required: true
      autoConfirm: false
    retryPolicy:
      maxAttempts: 2
    taskSpec:
      adapterKey: codex
      init:
        context:
          language: typescript
        skills: [coding, testing]
        mcps: [mcp://repo, mcp://ci]
        systemPrompts: [Write tests with implementation]
      payload:
        mockResult: success
  - key: hardening
    kind: task
    objective: Final hardening checks with Claude Code
    dependsOn: [implement]
    validation:
      mode: external
      required: true
      autoConfirm: false
    taskSpec:
      adapterKey: claude-code
      init:
        context:
          quality: high
        skills: [security-review, refactoring]
        mcps: [mcp://security]
        systemPrompts: [Prioritize correctness and readability]
      payload:
        mockResult: success
---

# Workflow Notes

Edit frontmatter to configure orchestration behavior.
`;

function resolveScaffoldFormat(targetPath: string, explicitFormat?: string): "markdown" | "json" {
  if (explicitFormat === "markdown" || explicitFormat === "json") {
    return explicitFormat;
  }

  return path.extname(targetPath).toLowerCase() === ".json" ? "json" : "markdown";
}

function parseScaffoldArgs(args: string[]): { targetPath?: string; format?: string } {
  let targetPath: string | undefined;
  let format: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--format") {
      format = args[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith("-") && !targetPath) {
      targetPath = arg;
    }
  }

  return { targetPath, format };
}

function cmdScaffold(targetPath?: string, format?: string): number {
  const resolvedPath = targetPath ? path.resolve(targetPath) : path.resolve("./example-workflow.md");
  const normalizedFormat = format?.toLowerCase();
  const resolvedFormat = resolveScaffoldFormat(resolvedPath, normalizedFormat);

  if (normalizedFormat && resolvedFormat !== normalizedFormat) {
    console.error(`Invalid --format value: ${format}. Use markdown or json.`);
    return 1;
  }

  const template =
    resolvedFormat === "json"
      ? `${JSON.stringify(WORKFLOW_SCAFFOLD_JSON, null, 2)}\n`
      : WORKFLOW_SCAFFOLD_MARKDOWN;

  fs.writeFileSync(resolvedPath, template, "utf-8");
  console.log(`Scaffolded ${resolvedFormat} workflow: ${resolvedPath}`);
  return 0;
}

function cmdMan(): number {
  const manPagePath = path.resolve("./man/wfm.1");

  if (!fs.existsSync(manPagePath)) {
    console.error(`Man page not found at ${manPagePath}`);
    return 1;
  }

  const result = spawnSync("man", [manPagePath], { stdio: "inherit" });
  if (result.status === 0) {
    return 0;
  }

  console.log("\n' man ' command unavailable, printing page contents:\n");
  console.log(fs.readFileSync(manPagePath, "utf-8"));
  return 0;
}

function cmdValidate(filePath: string): number {
  try {
    const workflow = parseWorkflowFile(path.resolve(filePath));
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.log("Validation failed:");
      for (const e of errors) console.log(`- ${e}`);
      return 1;
    }
    console.log("Validation OK");
    return 0;
  } catch (err) {
    console.error(`Validation error: ${(err as Error).message}`);
    return 1;
  }
}

async function runnerControlRequest(
  action: "approve" | "resume" | "cancel",
  args: string[]
): Promise<number> {
  const baseUrl = getFlagFromArgs(args, "--url") ?? process.env.WFM_RUNNER_URL;
  const token = getFlagFromArgs(args, "--token") ?? process.env.WFM_RUNNER_TOKEN;
  const stepKey = getFlagFromArgs(args, "--step");
  const actor = getFlagFromArgs(args, "--actor");
  const note = getFlagFromArgs(args, "--note");
  const source = getFlagFromArgs(args, "--source") ?? "cli";

  if (!baseUrl) {
    console.error(`Missing --url. You can also set WFM_RUNNER_URL.`);
    return 1;
  }

  if (!token) {
    console.error(`Missing --token. You can also set WFM_RUNNER_TOKEN.`);
    return 1;
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
  };

  let runId = getFlagFromArgs(args, "--run-id");
  if (!runId) {
    const sessionResponse = await fetch(`${baseUrl}/session`, { headers });
    if (!sessionResponse.ok) {
      const message = await sessionResponse.text();
      console.error(`Failed to discover run id: ${message}`);
      return 1;
    }
    const session = (await sessionResponse.json()) as { run?: { runId?: string } };
    runId = session.run?.runId;
  }

  if (!runId) {
    console.error("Could not determine run id. Pass --run-id explicitly.");
    return 1;
  }

  const response = await fetch(`${baseUrl}/runs/${runId}/${action}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stepKey,
      actor,
      note,
      source,
    }),
  });

  const payloadText = await response.text();
  const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Request failed with status ${response.status}`;
    console.error(`${action} failed: ${message}`);
    return 1;
  }

  const decision = typeof payload.decision === "string" ? payload.decision : action === "cancel" ? "cancelled" : "approved";
  const resolvedStep = typeof payload.stepKey === "string" ? payload.stepKey : stepKey ?? "current";
  console.log(`${decision} ${resolvedStep}`);
  return 0;
}

async function cmdRun(filePath: string): Promise<number> {
  const resolvedPath = path.resolve(filePath);
  const startedAt = Date.now();
  let workflow: WorkflowDefinition | undefined;
  let runnerServer: Awaited<ReturnType<typeof startRunnerApiServer>> | undefined;
  let sessionStore: RunnerSessionStore | undefined;
  let liveRenderer: CliRunRenderer | undefined;
  try {
    workflow = parseWorkflowFile(resolvedPath);
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.error(`Invalid workflow: ${errors.join("; ")}`);
      await emitRunTelemetryBestEffort({
        definition: workflow,
        sourceFilePath: resolvedPath,
        durationMs: Date.now() - startedAt,
        failureReason: errors.join("; "),
      });
      return 1;
    }

    const objective = getFlag("--objective");
    const inputRaw = getFlag("--input");
    let input: Record<string, unknown> = {};
    if (inputRaw) {
      let parsed: unknown;
      try {
        parsed = inputRaw.trimStart().startsWith("{")
          ? JSON.parse(inputRaw.replace(/[\n\r]/g, " "))
          : JSON.parse(fs.readFileSync(path.resolve(inputRaw), "utf-8"));
      } catch (error) {
        console.error(`--input must be a JSON object or path to a JSON object: ${(error as Error).message}`);
        return 1;
      }
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        console.error("--input must be a JSON object or path to a JSON object");
        return 1;
      }
      input = parsed as Record<string, unknown>;
    }
    const confirmRaw = getFlag("--confirm") ?? "";
    const confirmations = confirmRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const runId = randomUUID();
    const requestedPortRaw = getFlag("--port");
    const requestedPort = requestedPortRaw === undefined ? 0 : Number.parseInt(requestedPortRaw, 10);
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
      console.error("--port must be an integer between 0 and 65535");
      return 1;
    }

    sessionStore = new RunnerSessionStore({
      runId,
      workflow,
      objective: objective ?? workflow.title,
      objectives: workflow.objectives ?? [],
    });
    liveRenderer = new CliRunRenderer({
      workflow,
      verbose: hasFlag("--verbose"),
    });
    runnerServer = await startRunnerApiServer(sessionStore, requestedPort);
    const session = sessionStore.sessionInfo();
    process.stderr.write(`Attach API: ${session.baseUrl} (token ${session.attachToken})\n`);

    const result = await runWorkflow(workflow, {
      runId,
      objective,
      input,
      confirmations,
      autoConfirmAll: hasFlag("--auto-confirm-all"),
      interactive: process.stdin.isTTY,
      workflowFilePath: resolvedPath,
      approvalPrompt: async (request) => {
        liveRenderer?.pauseHeartbeat();
        try {
          const decision = await promptForApprovalDecision(
            request.stepKey,
            request.reason,
            request.validation ?? "external",
            request.preview ?? null,
            "cli",
            request.signal
          );

          if (!decision) {
            return null;
          }

          if (decision.decision === "cancelled") {
            sessionStore?.cancel(request.stepKey, {
              actor: decision.actor,
              note: decision.note,
              source: decision.source,
            });
          } else {
            sessionStore?.approve(request.stepKey, {
              actor: decision.actor,
              note: decision.note,
              source: decision.source,
            });
          }

          return null;
        } finally {
          liveRenderer?.resumeHeartbeat();
        }
      },
      observer: combineRunObservers(sessionStore, liveRenderer),
      controller: sessionStore,
    });
    liveRenderer.close();

    if (hasFlag("--json")) {
      console.log(JSON.stringify({ session: sessionStore.sessionInfo(), ...result }, null, 2));
    } else {
      const icon = result.status === "succeeded" ? "✓" : result.status === "waiting_for_approval" ? "◌" : "✗";
      process.stderr.write(`\n${icon} ${result.status} — ${workflow.title}\n\n`);
      for (const sr of result.stepRuns) {
        const stepIcon = sr.status === "succeeded" ? "✓" : sr.status === "waiting_for_approval" ? "◌" : "✗";
        const adapterKey = workflow.steps.find((s) => s.key === sr.stepKey)?.taskSpec?.adapterKey ?? "approval";
        process.stderr.write(`  ${stepIcon} ${sr.stepKey.padEnd(20)} ${adapterKey}\n`);
      }
      if (result.status !== "succeeded") {
        process.stderr.write(`\nRun --json to see full output.\n`);
      }
      process.stderr.write("\n");
    }
    await emitRunTelemetryBestEffort({
      definition: workflow,
      sourceFilePath: resolvedPath,
      durationMs: Date.now() - startedAt,
      result,
      failureReason: result.status === "failed" ? "run failed" : result.status === "waiting_for_approval" ? "confirmation required" : undefined,
    });
    return result.status === "succeeded" ? 0 : 2;
  } catch (err) {
    liveRenderer?.close();
    console.error(`Run error: ${(err as Error).message}`);
    if (workflow) {
      await emitRunTelemetryBestEffort({
        definition: workflow,
        sourceFilePath: resolvedPath,
        durationMs: Date.now() - startedAt,
        failureReason: (err as Error).message,
      });
    }
    return 1;
  } finally {
    liveRenderer?.close();
    await runnerServer?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  if (cmd === "questions") {
    cmdQuestions();
    process.exit(0);
  }

  if (cmd === "scaffold") {
    const { targetPath, format } = parseScaffoldArgs(process.argv.slice(3));
    process.exit(cmdScaffold(targetPath, format));
  }

  if (cmd === "man") {
    process.exit(cmdMan());
  }

  if (cmd === "validate") {
    const file = process.argv[3];
    if (!file) {
      usage();
      process.exit(1);
    }
    process.exit(cmdValidate(file));
  }

  if (cmd === "run") {
    const file = process.argv[3];
    if (!file) {
      usage();
      process.exit(1);
    }
    process.exit(await cmdRun(file));
  }

  if (cmd === "approve" || cmd === "resume" || cmd === "cancel") {
    process.exit(await runnerControlRequest(cmd, process.argv.slice(3)));
  }

  if (cmd === "auth") {
    process.exit(await cmdAuth(process.argv.slice(3)));
  }

  if (cmd === "search") {
    process.exit(await cmdSearch(process.argv.slice(3)));
  }

  if (cmd === "publish") {
    const file = process.argv[3];
    if (!file) {
      usage();
      process.exit(1);
    }
    process.exit(await cmdPublish(file, process.argv.slice(4)));
  }

  if (cmd === "pull") {
    const reference = process.argv[3];
    if (!reference) {
      usage();
      process.exit(1);
    }
    process.exit(await cmdPull(reference, process.argv.slice(4)));
  }

  if (cmd === "remote" && process.argv[3] === "info") {
    const reference = process.argv[4];
    if (!reference) {
      usage();
      process.exit(1);
    }
    process.exit(await cmdRemoteInfo(reference));
  }

  usage();
  process.exit(1);
}

void main();

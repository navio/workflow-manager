#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseWorkflowFile, validateWorkflow } from "./parser.js";
import { runWorkflow } from "./engine.js";
import { cmdAuth, cmdPublish, cmdPull, cmdRemoteInfo, cmdSearch } from "./remote/commands.js";
import type { WorkflowDefinition } from "./types.js";

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

function usage(): void {
  console.log(`workflow-manager commands:
  questions
  scaffold [path] [--format markdown|json]
  validate <workflow.md|workflow.json>
  run <workflow.md|workflow.json> [--input input.json] [--objective "string"] [--confirm stepA,stepB:human] [--auto-confirm-all]
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
  const manPagePath = path.resolve("./man/workflow-manager.1");

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

function cmdRun(filePath: string): number {
  try {
    const workflow = parseWorkflowFile(path.resolve(filePath));
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.error(`Invalid workflow: ${errors.join("; ")}`);
      return 1;
    }

    const objective = getFlag("--objective");
    const inputPath = getFlag("--input");
    const input = inputPath ? JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf-8")) : {};
    const confirmRaw = getFlag("--confirm") ?? "";
    const confirmations = confirmRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const result = runWorkflow(workflow, {
      objective,
      input,
      confirmations,
      autoConfirmAll: hasFlag("--auto-confirm-all"),
    });
    console.log(JSON.stringify(result, null, 2));
    return result.status === "succeeded" ? 0 : 2;
  } catch (err) {
    console.error(`Run error: ${(err as Error).message}`);
    return 1;
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
    process.exit(cmdRun(file));
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

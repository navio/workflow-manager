#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseWorkflowMarkdown, validateWorkflow } from "./parser.js";
import { runWorkflow } from "./engine.js";

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
  scaffold [path]
  validate <workflow.md>
  run <workflow.md> [--input input.json] [--objective "string"] [--confirm stepA,stepB:human] [--auto-confirm-all]`);
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
  console.log("- Finalized workflow markdown with per-step objectives");
  console.log("- Validation/approval confirmation map per step");
  console.log("- Adapter init map (opencode/codex/claude-code with context+skills+mcps)");
  console.log("- Runnable CLI command examples + run JSON output");
}

function cmdScaffold(targetPath?: string): void {
  const outPath = targetPath ? path.resolve(targetPath) : path.resolve("./example-workflow.md");
  const template = `---
key: workflow-manager-sample
title: Workflow Manager Sample
description: Markdown-defined workflow with per-step objectives and confirmations
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
  fs.writeFileSync(outPath, template, "utf-8");
  console.log(`Scaffolded: ${outPath}`);
}

function cmdValidate(filePath: string): number {
  try {
    const workflow = parseWorkflowMarkdown(path.resolve(filePath));
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
    const workflow = parseWorkflowMarkdown(path.resolve(filePath));
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

function main(): void {
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
    cmdScaffold(process.argv[3]);
    process.exit(0);
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

  usage();
  process.exit(1);
}

main();

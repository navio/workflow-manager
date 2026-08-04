#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { CliRunRenderer } from "./cliRunRenderer.js";
import { TuiRunRenderer } from "./tui/tuiRunRenderer.js";
import { startRunnerApiServer } from "./runnerApi.js";
import { RunnerSessionStore } from "./runnerSession.js";
import { parseWorkflowFile, validateWorkflow } from "./parser.js";
import { MAN_PAGE_SOURCE } from "./manPage.js";
import { promptForApprovalDecision, runWorkflow } from "./engine.js";
import { cmdAuth, cmdPublish, cmdPull, cmdRemoteInfo, cmdSearch, cmdTelemetry } from "./remote/commands.js";
import { readSessionFile, writeSessionFile } from "./sessionFile.js";
import type { RunnerSessionFile } from "./sessionFile.js";
import { emitRunTelemetryBestEffort } from "./remote/telemetry.js";
import { BUNDLED_SKILLS } from "./generated/bundledSkills.js";
import type { BundledSkillFile } from "./generated/bundledSkills.js";
import {
  adapterImplementationStatuses,
  adapterMockFallbackWarnings,
  runtimeDoctorChecks,
  validateRuntimeRequirements,
} from "./runtimePreflight.js";
import type { RunObserver, StepDetailSnapshot, WorkflowDefinition } from "./types.js";

// Replaced at compile time for standalone binaries via `bun build --define`
// (see scripts/build-binary.mjs); undefined in the tsc/npm build, where the
// version is read from package.json at runtime instead.
declare const WFM_VERSION: string | undefined;

function resolveVersion(): string {
  if (typeof WFM_VERSION === "string" && WFM_VERSION) {
    return WFM_VERSION;
  }

  const modulePath = fileURLToPath(import.meta.url);
  const candidates = [
    path.join(path.dirname(path.dirname(modulePath)), "package.json"),
    path.resolve("./package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // try the next candidate
    }
  }
  return "unknown";
}

function cliDisplayName(): string {
  const invokedAs = path.basename(process.argv[1] ?? "");
  if (invokedAs === "workflow-manager" || invokedAs === "wfm") {
    return invokedAs;
  }

  return "wfm";
}

function usage(): void {
  const cli = cliDisplayName();
  const row = (command: string, description: string): string => `  ${command.padEnd(28)}${description}`;
  console.log(
    [
      `${cli} — run multi-step AI agent workflows from the CLI`,
      "",
      `Usage: ${cli} <command> [options]`,
      "",
      "Author and run workflows",
      row("scaffold [path]", "Write a starter workflow file (--template agent-validated for validator example)"),
      row("validate <file>", "Check a workflow for errors"),
      row("doctor [file]", "Check host setup; with a file, preflight it"),
      row("run <file>", "Run a workflow with live progress (--ui for full-screen)"),
      "",
      "Control or observe a running workflow",
      row("approve", "Approve a step waiting for review"),
      row("resume", "Resume a step waiting on external input"),
      row("cancel", "Cancel a waiting step"),
      row("status [--step <key>]", "Print the run (or step) snapshot as JSON"),
      row("logs [--step <key>]", "Print buffered agent logs as JSON"),
      row("events [--since <seq>]", "Print run events as JSON (one-shot poll)"),
      "  Connect with --url/--token, --session-file <path> (written by run --session-file),",
      "  or WFM_RUNNER_URL/WFM_RUNNER_TOKEN.",
      "",
      "Share workflows (remote registry)",
      row("auth <login|whoami|logout>", "Sign in, check, or sign out"),
      row("telemetry <status|on|off>", "View or set the local run telemetry preference"),
      row("search [query]", "Find shared workflows"),
      row("publish <file>", "Publish a workflow"),
      row("pull <owner/slug>", "Download a shared workflow"),
      row("remote info <owner/slug>", "Show a shared workflow's details"),
      "",
      "Agent skills and help",
      row("skill list", "List skills bundled with wfm"),
      row("skill install [name ...]", "Install skills into an agent (Claude Code, opencode)"),
      row("man", "Full manual with every option and examples"),
      row("--version", "Print the installed wfm version"),
      "",
      `Run \`${cli} man\` for all flags and examples.`,
    ].join("\n")
  );
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
    {
      key: "acp_review",
      kind: "task",
      objective: "Example ACP step: set useRealAdapter + acpAgent to run a real agent; mocks otherwise",
      dependsOn: ["hardening"],
      validation: { mode: "none", required: false, autoConfirm: true },
      taskSpec: {
        adapterKey: "acp",
        init: { systemPrompts: ["Review the implementation"] },
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
  - key: acp_review
    kind: task
    objective: "Example ACP step: set useRealAdapter + acpAgent to run a real agent; mocks otherwise"
    dependsOn: [hardening]
    validation:
      mode: none
      required: false
      autoConfirm: true
    taskSpec:
      adapterKey: acp
      init:
        systemPrompts: [Review the implementation]
      payload:
        mockResult: success
---

# Workflow Notes

Edit frontmatter to configure orchestration behavior.
`;

const WORKFLOW_SCAFFOLD_AGENT_VALIDATED_JSON: WorkflowDefinition = {
  key: "agent-validated-pipeline",
  title: "Agent-Validated Pipeline",
  description: "Repeatable task pipeline where a second agent checks the implementation against explicit criteria",
  objectives: ["ship a change that meets the stated acceptance criteria"],
  defaultRetryPolicy: { maxAttempts: 2 },
  steps: [
    {
      key: "implement",
      kind: "task",
      objective: "Implement the requested change",
      dependsOn: [],
      retryPolicy: { maxAttempts: 2 },
      validation: {
        mode: "agent",
        required: true,
        autoConfirm: false,
        agent: {
          criteria:
            "The change satisfies the workflow objective, builds cleanly, and includes tests for new behavior.",
          init: {
            model: "openrouter/anthropic/claude-sonnet-4",
            systemPrompts: ["Check the diff against the criteria; be specific about any gaps found"],
          },
        },
      },
      taskSpec: {
        init: {
          context: { repo: "example/repo" },
          skills: ["coding", "testing"],
          systemPrompts: ["Implement the change described in the workflow objective"],
        },
        payload: { mockResult: "success" },
      },
    },
    {
      key: "review-gate",
      kind: "approval",
      objective: "Human sign-off before finalizing",
      dependsOn: ["implement"],
      validation: { mode: "human", required: true, autoConfirm: false },
      approvalSpec: {
        autoApprove: false,
        validation: { mode: "human", required: true, autoConfirm: false },
      },
    },
    {
      key: "finalize",
      kind: "task",
      objective: "Finalize the change (for example, open a PR)",
      dependsOn: ["review-gate"],
      validation: { mode: "none", required: false, autoConfirm: true },
      taskSpec: {
        init: {
          systemPrompts: ["Open a PR summarizing the change and its validation history"],
        },
        payload: { mockResult: "success" },
      },
    },
  ],
};

const WORKFLOW_SCAFFOLD_AGENT_VALIDATED_MARKDOWN = `---
key: agent-validated-pipeline
title: Agent-Validated Pipeline
description: Repeatable task pipeline where a second agent checks the implementation against explicit criteria
objectives:
  - ship a change that meets the stated acceptance criteria
defaultRetryPolicy:
  maxAttempts: 2
steps:
  # "implement" omits taskSpec.adapterKey, so it runs on the default pi-agent adapter.
  - key: implement
    kind: task
    objective: Implement the requested change
    dependsOn: []
    retryPolicy:
      maxAttempts: 2
    validation:
      # mode: agent routes this step through a second, independent agent call after
      # implement finishes. That validator agent reads validation.agent.criteria,
      # returns a verdict (SUCCESS/QA_REJECTED/...), and the engine maps it to a QA
      # action: PROCEED keeps going, RETRY_CURRENT reruns this step, ROLLBACK_PREVIOUS
      # reruns an earlier step, RESTART_ALL restarts the run. Sharpen criteria to
      # control what the validator accepts.
      mode: agent
      required: true
      autoConfirm: false
      agent:
        criteria: >-
          The change satisfies the workflow objective, builds cleanly, and
          includes tests for new behavior.
        init:
          model: openrouter/anthropic/claude-sonnet-4
          systemPrompts:
            - Check the diff against the criteria; be specific about any gaps found
    taskSpec:
      init:
        context:
          repo: example/repo
        skills: [coding, testing]
        systemPrompts: [Implement the change described in the workflow objective]
      payload:
        # mockResult drives the mock adapter for local dry runs; real adapters ignore it.
        mockResult: success
  - key: review-gate
    kind: approval
    objective: Human sign-off before finalizing
    dependsOn: [implement]
    # Top-level validation must match approvalSpec.validation: without it, the
    # parser's default (autoConfirm: true) wins and the gate auto-approves.
    validation:
      mode: human
      required: true
      autoConfirm: false
    approvalSpec:
      autoApprove: false
      validation:
        mode: human
        required: true
        autoConfirm: false
  - key: finalize
    kind: task
    objective: "Finalize the change (for example, open a PR)"
    dependsOn: [review-gate]
    validation:
      mode: none
      required: false
      autoConfirm: true
    taskSpec:
      init:
        systemPrompts: [Open a PR summarizing the change and its validation history]
      payload:
        mockResult: success
---

# Agent-Validated Pipeline

This workflow shows first-class agent validation: instead of (or in addition to) a
human or external check, a step's own output can be graded by a second agent call.

- \`implement\` runs, then its \`validation.agent\` config sends the result to a
  validator agent along with \`criteria\` — plain-language acceptance criteria the
  validator checks the work against.
- The validator's verdict becomes a QA action: \`PROCEED\` lets the run continue,
  \`RETRY_CURRENT\` re-runs \`implement\` with the validator's feedback,
  \`ROLLBACK_PREVIOUS\` re-runs an earlier step, and \`RESTART_ALL\` restarts the run.
  Retries are bounded by \`retryPolicy.maxAttempts\`.
- \`review-gate\` is a human approval step — agent validation cannot be used on
  approval steps, so high-stakes changes still get a human in the loop before
  \`finalize\` runs.

Tighten \`validation.agent.criteria\` to describe exactly what "done" means for this
step; the validator only knows what criteria tells it.
`;

function resolveScaffoldFormat(targetPath: string, explicitFormat?: string): "markdown" | "json" {
  if (explicitFormat === "markdown" || explicitFormat === "json") {
    return explicitFormat;
  }

  return path.extname(targetPath).toLowerCase() === ".json" ? "json" : "markdown";
}

function parseScaffoldArgs(args: string[]): { targetPath?: string; format?: string; template?: string } {
  let targetPath: string | undefined;
  let format: string | undefined;
  let template: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--format") {
      format = args[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--template") {
      template = args[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith("-") && !targetPath) {
      targetPath = arg;
    }
  }

  return { targetPath, format, template };
}

const DEFAULT_INSTALL_SKILL = "workflow-manager-cli";

const SKILL_INSTALL_TARGETS: Record<string, { projectDir: string; globalDir: string }> = {
  claude: {
    projectDir: path.join(".claude", "skills"),
    globalDir: path.join(os.homedir(), ".claude", "skills"),
  },
  opencode: {
    projectDir: path.join(".opencode", "skill"),
    globalDir: path.join(os.homedir(), ".config", "opencode", "skill"),
  },
};

// A packaged skill's file contents come from one of two sources: the
// skills/ directory on disk next to this module (npm installs, `bun run
// dev`), or the BUNDLED_SKILLS module embedded at build time (standalone
// `bun build --compile` binaries, which don't ship skills/ on disk). On-disk
// always wins when present; BUNDLED_SKILLS is the fallback.
type PackagedSkillSource = { kind: "disk"; dir: string } | { kind: "bundled"; files: BundledSkillFile[] };

export interface PackagedSkill {
  name: string;
  description: string;
  source: PackagedSkillSource;
}

export function packagedSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

export function parseSkillDescription(skillMarkdown: string): string {
  try {
    const parsed = matter(skillMarkdown);
    if (typeof parsed.data.description === "string") {
      return parsed.data.description.replace(/\s+/g, " ").trim();
    }
  } catch {
    // skills without parseable frontmatter are still installable
  }

  return "";
}

export function listPackagedSkillsFromDisk(root: string): PackagedSkill[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const skills: PackagedSkill[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const skillFile = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    const description = parseSkillDescription(fs.readFileSync(skillFile, "utf-8"));
    skills.push({ name: entry.name, description, source: { kind: "disk", dir } });
  }

  return skills;
}

export function listPackagedSkillsFromBundle(bundle: Record<string, BundledSkillFile[]> = BUNDLED_SKILLS): PackagedSkill[] {
  const skills: PackagedSkill[] = [];
  for (const name of Object.keys(bundle).sort()) {
    const files = bundle[name];
    const skillFile = files.find((file) => file.name === "SKILL.md");
    if (!skillFile) continue;

    skills.push({ name, description: parseSkillDescription(skillFile.content), source: { kind: "bundled", files } });
  }

  return skills;
}

export function listPackagedSkills(root: string = packagedSkillsDir()): PackagedSkill[] {
  const onDisk = listPackagedSkillsFromDisk(root);
  if (onDisk.length > 0) {
    return onDisk;
  }

  return listPackagedSkillsFromBundle();
}

export function materializeSkillFiles(skill: PackagedSkill, destDir: string): void {
  if (skill.source.kind === "disk") {
    for (const entry of fs.readdirSync(skill.source.dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === "README.md") continue;
      fs.copyFileSync(path.join(skill.source.dir, entry.name), path.join(destDir, entry.name));
    }
    return;
  }

  for (const file of skill.source.files) {
    if (file.name === "README.md") continue;
    fs.writeFileSync(path.join(destDir, file.name), file.content, "utf-8");
  }
}

function cmdSkillList(): number {
  const skills = listPackagedSkills();
  if (skills.length === 0) {
    console.error(`No bundled skills found at ${packagedSkillsDir()}.`);
    return 1;
  }

  console.log("Bundled skills:\n");
  for (const skill of skills) {
    console.log(`  ${skill.name}`);
    if (skill.description) {
      console.log(`      ${skill.description}`);
    }
  }
  console.log(`\nInstall with: ${cliDisplayName()} skill install <name> [--agent claude|opencode] [--global]`);
  return 0;
}

interface SkillInstallArgs {
  names: string[];
  agent: string;
  global: boolean;
  dir?: string;
  force: boolean;
  all: boolean;
}

function parseSkillInstallArgs(args: string[]): SkillInstallArgs {
  const parsed: SkillInstallArgs = { names: [], agent: "claude", global: false, force: false, all: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--agent") {
      parsed.agent = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--dir") {
      parsed.dir = args[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--global" || arg === "-g") {
      parsed.global = true;
      continue;
    }

    if (arg === "--force" || arg === "-f") {
      parsed.force = true;
      continue;
    }

    if (arg === "--all") {
      parsed.all = true;
      continue;
    }

    if (!arg.startsWith("-")) {
      parsed.names.push(arg);
    }
  }

  return parsed;
}

function resolveSkillInstallRoot(args: SkillInstallArgs): string | undefined {
  if (args.dir) {
    return path.resolve(args.dir);
  }

  const target = SKILL_INSTALL_TARGETS[args.agent];
  if (!target) {
    return undefined;
  }

  return args.global ? target.globalDir : path.resolve(target.projectDir);
}

function cmdSkillInstall(args: string[]): number {
  const parsed = parseSkillInstallArgs(args);
  const targetRoot = resolveSkillInstallRoot(parsed);
  if (!targetRoot) {
    console.error(
      `Unknown --agent value: ${parsed.agent}. Supported agents: ${Object.keys(SKILL_INSTALL_TARGETS).join(", ")}. Use --dir for any other destination.`
    );
    return 1;
  }

  const available = listPackagedSkills();
  const names = parsed.all
    ? available.map((skill) => skill.name)
    : parsed.names.length > 0
      ? parsed.names
      : [DEFAULT_INSTALL_SKILL];

  for (const name of names) {
    const skill = available.find((candidate) => candidate.name === name);
    if (!skill) {
      console.error(`Unknown skill: ${name}. Run \`${cliDisplayName()} skill list\` to see bundled skills.`);
      return 1;
    }

    const destDir = path.join(targetRoot, name);
    const destFile = path.join(destDir, "SKILL.md");
    if (fs.existsSync(destFile) && !parsed.force) {
      console.error(`Skill already installed at ${destFile}. Pass --force to overwrite.`);
      return 1;
    }

    fs.mkdirSync(destDir, { recursive: true });
    materializeSkillFiles(skill, destDir);
    console.log(`Installed skill ${name} -> ${destDir}`);
  }

  return 0;
}

function cmdScaffold(targetPath?: string, format?: string, template?: string): number {
  const resolvedPath = targetPath ? path.resolve(targetPath) : path.resolve("./example-workflow.md");
  const normalizedFormat = format?.toLowerCase();
  const resolvedFormat = resolveScaffoldFormat(resolvedPath, normalizedFormat);

  if (normalizedFormat && resolvedFormat !== normalizedFormat) {
    console.error(`Invalid --format value: ${format}. Use markdown or json.`);
    return 1;
  }

  const normalizedTemplate = template?.toLowerCase() ?? "default";
  if (normalizedTemplate !== "default" && normalizedTemplate !== "agent-validated") {
    console.error(`Invalid --template value: ${template}. Use default or agent-validated.`);
    return 1;
  }

  const content =
    normalizedTemplate === "agent-validated"
      ? resolvedFormat === "json"
        ? `${JSON.stringify(WORKFLOW_SCAFFOLD_AGENT_VALIDATED_JSON, null, 2)}\n`
        : WORKFLOW_SCAFFOLD_AGENT_VALIDATED_MARKDOWN
      : resolvedFormat === "json"
        ? `${JSON.stringify(WORKFLOW_SCAFFOLD_JSON, null, 2)}\n`
        : WORKFLOW_SCAFFOLD_MARKDOWN;

  fs.writeFileSync(resolvedPath, content, "utf-8");
  console.log(`Scaffolded ${resolvedFormat} workflow: ${resolvedPath}`);
  return 0;
}

function cmdMan(): number {
  const modulePath = fileURLToPath(import.meta.url);
  const packageRoot = path.dirname(path.dirname(modulePath));
  const candidatePaths = [path.join(packageRoot, "man", "wfm.1"), path.resolve("./man/wfm.1")];
  const manPagePath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));

  let fallbackSource = MAN_PAGE_SOURCE;
  let tempDir: string | undefined;
  const resolvedManPagePath =
    manPagePath ??
    (() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfm-man-"));
      const tempManPagePath = path.join(tempDir, "wfm.1");
      fs.writeFileSync(tempManPagePath, MAN_PAGE_SOURCE, "utf-8");
      return tempManPagePath;
    })();

  if (manPagePath) {
    fallbackSource = fs.readFileSync(manPagePath, "utf-8");
  }

  try {
    const result = spawnSync("man", [resolvedManPagePath], { stdio: "inherit" });
    if (result.status === 0) {
      return 0;
    }

    console.log("\n' man ' command unavailable, printing page contents:\n");
    console.log(fallbackSource);
    return 0;
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
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

function renderStatus(status: "ok" | "missing" | "info"): string {
  if (status === "ok") return "OK";
  if (status === "missing") return "MISSING";
  return "INFO";
}

function cmdDoctor(args: string[]): number {
  const workflowPath = args.find((arg) => !arg.startsWith("-"));
  const json = args.includes("--json");
  const hostChecks = runtimeDoctorChecks();
  const adapterStatuses = adapterImplementationStatuses();
  let workflow: WorkflowDefinition | null = null;
  let workflowErrors: string[] = [];
  let runtimeErrors: string[] = [];
  let adapterWarnings: ReturnType<typeof adapterMockFallbackWarnings> = [];

  if (workflowPath) {
    try {
      workflow = parseWorkflowFile(path.resolve(workflowPath));
      workflowErrors = validateWorkflow(workflow);
      if (workflowErrors.length === 0) {
        runtimeErrors = validateRuntimeRequirements(workflow);
        adapterWarnings = adapterMockFallbackWarnings(workflow);
      }
    } catch (err) {
      workflowErrors = [(err as Error).message];
    }
  }

  const baselineErrors = workflowPath
    ? []
    : hostChecks
        .filter((check) => check.required && check.status === "missing")
        .map((check) => `${check.label}: ${check.detail}`);
  const exitCode =
    baselineErrors.length > 0 || workflowErrors.length > 0 || runtimeErrors.length > 0 ? 1 : 0;

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          hostChecks,
          adapterStatuses,
          workflow: workflow
            ? {
                key: workflow.key,
                title: workflow.title,
                errors: workflowErrors,
                runtimeErrors,
                adapterWarnings,
              }
            : null,
          baselineErrors,
        },
        null,
        2
      )
    );
    return exitCode;
  }

  console.log("Workflow Manager Doctor");
  console.log("\nHost runtime:");
  for (const check of hostChecks) {
    const required = check.required ? "required" : "optional";
    console.log(`- ${renderStatus(check.status)} ${check.label} (${required}): ${check.detail}`);
  }

  console.log("\nAdapter implementation:");
  for (const adapter of adapterStatuses) {
    console.log(`- ${adapter.adapter}: ${adapter.status} - ${adapter.detail}`);
  }

  if (workflowPath) {
    console.log(`\nWorkflow: ${workflowPath}`);
    if (workflowErrors.length > 0) {
      console.log("- INVALID schema:");
      for (const error of workflowErrors) {
        console.log(`  - ${error}`);
      }
    } else if (runtimeErrors.length > 0) {
      console.log("- INVALID runtime:");
      for (const error of runtimeErrors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("- OK workflow schema and runtime requirements");
    }

    if (adapterWarnings.length > 0) {
      console.log("\nAdapter warnings:");
      for (const warning of adapterWarnings) {
        console.log(`- ${warning.stepKey}: ${warning.message}`);
      }
    }
  }

  return exitCode;
}

interface RunnerConnection {
  baseUrl: string;
  token: string;
  runId?: string;
}

function resolveRunnerConnection(args: string[]): RunnerConnection | string {
  let baseUrl = getFlagFromArgs(args, "--url");
  let token = getFlagFromArgs(args, "--token");
  let runId = getFlagFromArgs(args, "--run-id");

  const sessionFilePath = getFlagFromArgs(args, "--session-file");
  if (sessionFilePath && (!baseUrl || !token || !runId)) {
    const session = readSessionFile(sessionFilePath);
    if (typeof session === "string") {
      return session;
    }
    baseUrl = baseUrl ?? session.baseUrl;
    token = token ?? session.attachToken;
    runId = runId ?? session.runId;
  }

  baseUrl = baseUrl ?? process.env.WFM_RUNNER_URL;
  token = token ?? process.env.WFM_RUNNER_TOKEN;

  if (!baseUrl) {
    return `Missing --url. You can also pass --session-file or set WFM_RUNNER_URL.`;
  }

  if (!token) {
    return `Missing --token. You can also pass --session-file or set WFM_RUNNER_TOKEN.`;
  }

  return { baseUrl, token, runId };
}

async function resolveRunnerRunId(
  connection: RunnerConnection,
  headers: HeadersInit
): Promise<{ runId?: string; error?: string }> {
  if (connection.runId) {
    return { runId: connection.runId };
  }

  const sessionResponse = await fetch(`${connection.baseUrl}/session`, { headers });
  if (!sessionResponse.ok) {
    const message = await sessionResponse.text();
    return { error: `Failed to discover run id: ${message}` };
  }
  const session = (await sessionResponse.json()) as { run?: { runId?: string } };
  const runId = session.run?.runId;
  if (!runId) {
    return { error: "Could not determine run id. Pass --run-id explicitly." };
  }

  return { runId };
}

async function runnerControlRequest(
  action: "approve" | "resume" | "cancel",
  args: string[]
): Promise<number> {
  const connection = resolveRunnerConnection(args);
  if (typeof connection === "string") {
    console.error(connection);
    return 1;
  }

  const stepKey = getFlagFromArgs(args, "--step");
  const actor = getFlagFromArgs(args, "--actor");
  const note = getFlagFromArgs(args, "--note");
  const source = getFlagFromArgs(args, "--source") ?? "cli";

  const headers: HeadersInit = {
    Authorization: `Bearer ${connection.token}`,
  };

  const resolved = await resolveRunnerRunId(connection, headers);
  if (resolved.error || !resolved.runId) {
    console.error(resolved.error ?? "Could not determine run id. Pass --run-id explicitly.");
    return 1;
  }
  const runId = resolved.runId;

  const response = await fetch(`${connection.baseUrl}/runs/${runId}/${action}`, {
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

async function runnerReadRequest(command: "status" | "logs" | "events", args: string[]): Promise<number> {
  const connection = resolveRunnerConnection(args);
  if (typeof connection === "string") {
    console.error(connection);
    return 1;
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${connection.token}`,
  };

  try {
    const resolved = await resolveRunnerRunId(connection, headers);
    if (resolved.error || !resolved.runId) {
      console.error(resolved.error ?? "Could not determine run id. Pass --run-id explicitly.");
      return 1;
    }
    const runId = encodeURIComponent(resolved.runId);

    let requestPath: string;
    if (command === "status") {
      const stepKey = getFlagFromArgs(args, "--step");
      requestPath = stepKey ? `/runs/${runId}/steps/${encodeURIComponent(stepKey)}` : `/runs/${runId}`;
    } else if (command === "logs") {
      const query = new URLSearchParams();
      const stepKey = getFlagFromArgs(args, "--step");
      const limit = getFlagFromArgs(args, "--limit");
      const cursor = getFlagFromArgs(args, "--cursor");
      if (stepKey) query.set("stepKey", stepKey);
      if (limit) query.set("limit", limit);
      if (cursor) query.set("cursor", cursor);
      const queryString = query.toString();
      requestPath = `/runs/${runId}/logs${queryString ? `?${queryString}` : ""}`;
    } else {
      const query = new URLSearchParams();
      const since = getFlagFromArgs(args, "--since");
      if (since) query.set("sinceSequence", since);
      query.set("includeLogs", args.includes("--include-logs") ? "true" : "false");
      requestPath = `/runs/${runId}/events/list?${query.toString()}`;
    }

    const response = await fetch(`${connection.baseUrl}${requestPath}`, { headers });
    const payloadText = await response.text();
    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const payload = JSON.parse(payloadText) as Record<string, unknown>;
        if (typeof payload.message === "string") {
          message = payload.message;
        }
      } catch {
        // keep the fallback message
      }
      console.error(`${command} failed: ${message}`);
      return 1;
    }

    console.log(payloadText);
    return 0;
  } catch (error) {
    console.error(`${command} failed: ${(error as Error).message}`);
    return 1;
  }
}

async function cmdRun(filePath: string): Promise<number> {
  const resolvedPath = path.resolve(filePath);
  const startedAt = Date.now();
  const sessionFilePath = getFlag("--session-file");
  let sessionFileState: RunnerSessionFile | undefined;
  let finalRunStatus: string | undefined;
  let workflow: WorkflowDefinition | undefined;
  let runnerServer: Awaited<ReturnType<typeof startRunnerApiServer>> | undefined;
  let sessionStore: RunnerSessionStore | undefined;
  let liveRenderer: CliRunRenderer | undefined;
  let tuiRenderer: TuiRunRenderer | undefined;
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

    for (const warning of adapterMockFallbackWarnings(workflow)) {
      process.stderr.write(`⚠ ${warning.stepKey}: ${warning.message}\n`);
    }

    const objective = getFlag("--objective");
    const inputRaw = getFlag("--input");
    let input: Record<string, unknown> = {};
    if (inputRaw) {
      const parsed: unknown = inputRaw.trimStart().startsWith("{")
        ? JSON.parse(inputRaw.replace(/[\n\r]/g, " "))
        : JSON.parse(fs.readFileSync(path.resolve(inputRaw), "utf-8"));
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        console.error("--input must be a JSON object");
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

    const wantUi = hasFlag("--ui");
    const useTui = wantUi && process.stdout.isTTY === true && process.stdin.isTTY === true;
    if (wantUi && !useTui) {
      process.stderr.write("⚠ --ui requires an interactive terminal; falling back to standard output\n");
    }

    sessionStore = new RunnerSessionStore({
      runId,
      workflow,
      objective: objective ?? workflow.title,
      objectives: workflow.objectives ?? [],
    });
    if (!useTui) {
      liveRenderer = new CliRunRenderer({
        workflow,
        verbose: hasFlag("--verbose"),
      });
    }
    runnerServer = await startRunnerApiServer(sessionStore, requestedPort);
    const session = sessionStore.sessionInfo();
    if (sessionFilePath) {
      sessionFileState = {
        baseUrl: session.baseUrl,
        attachToken: session.attachToken,
        runId,
        pid: process.pid,
        startedAt: session.startedAt,
      };
      writeSessionFile(sessionFilePath, sessionFileState);
    }
    if (!useTui) {
      process.stderr.write(`Attach API: ${session.baseUrl} (token ${session.attachToken})\n`);
    }

    if (useTui) {
      tuiRenderer = new TuiRunRenderer({
        workflow,
        session: sessionStore,
        attachUrl: session.baseUrl,
        attachToken: session.attachToken,
      });
      tuiRenderer.start();
    }

    const result = await runWorkflow(workflow, {
      runId,
      objective,
      input,
      confirmations,
      autoConfirmAll: hasFlag("--auto-confirm-all"),
      interactive: useTui ? false : process.stdin.isTTY,
      workflowFilePath: resolvedPath,
      approvalPrompt: useTui
        ? undefined
        : async (request) => {
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

              const metadata = {
                actor: decision.actor,
                note: decision.note,
                source: decision.source,
              };
              const outcome =
                decision.decision === "cancelled"
                  ? sessionStore?.cancel(request.stepKey, metadata)
                  : request.validation === "external"
                    ? sessionStore?.resume(request.stepKey, metadata)
                    : sessionStore?.approve(request.stepKey, metadata);
              if (outcome && !outcome.ok) {
                process.stderr.write(
                  `Could not apply terminal decision for ${request.stepKey}: ${outcome.reason ?? "unknown error"}\n`
                );
              }

              return null;
            } finally {
              liveRenderer?.resumeHeartbeat();
            }
          },
      observer: combineRunObservers(sessionStore, useTui ? tuiRenderer : liveRenderer),
      controller: sessionStore,
    });
    tuiRenderer?.stop();
    liveRenderer?.close();
    finalRunStatus = result.status;

    if (hasFlag("--json")) {
      console.log(JSON.stringify({ session: sessionStore.sessionInfo(), ...result }, null, 2));
    } else {
      const icon = result.status === "succeeded" ? "✓" : result.status === "waiting_for_approval" ? "◌" : "✗";
      process.stderr.write(`\n${icon} ${result.status} — ${workflow.title}\n\n`);
      for (const sr of result.stepRuns) {
        const stepIcon = sr.status === "succeeded" ? "✓" : sr.status === "waiting_for_approval" ? "◌" : "✗";
        const step = workflow.steps.find((s) => s.key === sr.stepKey);
        const adapterKey = step?.kind === "task" ? (step.taskSpec?.adapterKey ?? "pi-agent") : "approval";
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
    tuiRenderer?.stop();
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
    tuiRenderer?.stop();
    liveRenderer?.close();
    if (sessionFilePath && sessionFileState) {
      try {
        writeSessionFile(sessionFilePath, {
          ...sessionFileState,
          endedAt: new Date().toISOString(),
          status: finalRunStatus ?? "failed",
        });
      } catch {
        // session-file finalization is best effort; the run result is authoritative
      }
    }
    await runnerServer?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log(resolveVersion());
    process.exit(0);
  }

  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  if (cmd === "doctor") {
    process.exit(cmdDoctor(process.argv.slice(3)));
  }

  if (cmd === "skill") {
    const sub = process.argv[3];
    if (sub === "list") {
      process.exit(cmdSkillList());
    }
    if (sub === "install") {
      process.exit(cmdSkillInstall(process.argv.slice(4)));
    }
    usage();
    process.exit(1);
  }

  if (cmd === "scaffold") {
    const { targetPath, format, template } = parseScaffoldArgs(process.argv.slice(3));
    process.exit(cmdScaffold(targetPath, format, template));
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

  if (cmd === "status" || cmd === "logs" || cmd === "events") {
    process.exit(await runnerReadRequest(cmd, process.argv.slice(3)));
  }

  if (cmd === "auth") {
    process.exit(await cmdAuth(process.argv.slice(3)));
  }

  if (cmd === "telemetry") {
    process.exit(cmdTelemetry(process.argv.slice(3)));
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

// Run main() only when this module is the process entrypoint (direct `bun
// run`/`node` invocation, an npm-installed symlinked bin, or a `bun build
// --compile` standalone binary) — never when imported as a module, e.g. by
// tests exercising the exported skill-catalog helpers below.
function isEntryModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  const self = fileURLToPath(import.meta.url);
  let invoked = process.argv[1];
  try {
    invoked = fs.realpathSync(invoked);
  } catch {
    // compiled/virtual filesystem paths (e.g. bun's $bunfs) can't be
    // realpath'd; fall back to the raw invoked path.
  }

  try {
    return path.resolve(invoked) === self;
  } catch {
    return false;
  }
}

if (isEntryModule()) {
  void main();
}

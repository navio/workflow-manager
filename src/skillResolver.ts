import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkflowDefinition } from "./types.js";

export interface ResolvedSkill {
  content: string;
  origin: string;
}

function readFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function isSafeSkillName(name: string): boolean {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return /^[a-zA-Z0-9_.-]+$/.test(name);
}

function tryRead(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    const content = readFileSafe(candidate);
    if (content && content.trim()) return content;
  }
  return null;
}

export function resolveSkill(
  name: string,
  workflow: WorkflowDefinition,
  workflowFilePath: string
): ResolvedSkill | null {
  const entry = workflow.skills?.[name];

  if (entry?.content && entry.content.trim()) {
    return { content: entry.content, origin: "embedded" };
  }

  if (entry?.source) {
    const workflowDir = path.dirname(path.resolve(workflowFilePath));
    const sourcePath = path.resolve(workflowDir, entry.source);
    const content = readFileSafe(sourcePath);
    if (content && content.trim()) return { content, origin: "source" };
  }

  if (!isSafeSkillName(name)) return null;

  const workflowDir = path.dirname(path.resolve(workflowFilePath));

  const projectLocal = tryRead(path.join(workflowDir, "skills", name, "SKILL.md"));
  if (projectLocal) return { content: projectLocal, origin: "project-local" };

  const userGlobal = tryRead(path.join(os.homedir(), ".workflow-manager", "skills", name, "SKILL.md"));
  if (userGlobal) return { content: userGlobal, origin: "user-global" };

  const packaged = tryRead(
    path.join(workflowDir, "node_modules", "workflow-manager", "skills", name, "SKILL.md"),
    path.join(workflowDir, "..", "node_modules", "workflow-manager", "skills", name, "SKILL.md")
  );
  if (packaged) return { content: packaged, origin: "npm" };

  return null;
}

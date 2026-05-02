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

function isAllowedLocalSkillSourcePath(source: string): boolean {
  if (!source || path.isAbsolute(source) || source.includes("\\") || source.includes("..")) return false;
  const normalized = path.posix.normalize(source);
  const withoutDot = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  if (!withoutDot.startsWith("skills/")) return false;
  return withoutDot.endsWith("/SKILL.md");
}

function resolveAllowedLocalSkillSourcePath(workflowDir: string, source: string): string | null {
  if (!isAllowedLocalSkillSourcePath(source)) return null;
  const sourcePath = path.resolve(workflowDir, source);
  const allowedRoot = path.resolve(workflowDir, "skills");
  if (!sourcePath.startsWith(`${allowedRoot}${path.sep}`)) return null;
  if (path.basename(sourcePath) !== "SKILL.md") return null;
  return sourcePath;
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
    const sourcePath = resolveAllowedLocalSkillSourcePath(workflowDir, entry.source);
    if (!sourcePath) return null;
    const content = readFileSafe(sourcePath);
    if (content && content.trim()) return { content, origin: "source" };
    return null;
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

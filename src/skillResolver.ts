import fs from "node:fs";
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
    if (content && content.trim()) {
      return { content, origin: "source" };
    }
  }

  return null;
}

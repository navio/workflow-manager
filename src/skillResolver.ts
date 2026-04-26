import type { WorkflowDefinition } from "./types.js";

export interface ResolvedSkill {
  content: string;
  origin: string;
}

export function resolveSkill(
  name: string,
  workflow: WorkflowDefinition,
  workflowFilePath: string
): ResolvedSkill | null {
  const embedded = workflow.skills?.[name]?.content;
  if (typeof embedded === "string" && embedded.trim()) {
    return { content: embedded, origin: "embedded" };
  }
  return null;
}

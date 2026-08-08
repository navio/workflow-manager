import { createHash } from "node:crypto";
import fs from "node:fs";
import type { WorkflowDefinition } from "../types.js";

export const PROVENANCE_SCHEMA_VERSION = 1 as const;

export interface WorkflowProvenanceSidecar {
  schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  namespaceId: string;
  workflowVersionId: string;
  versionLabel: string;
  workflowFingerprint: string;
}

export interface ResolvedWorkflowProvenance {
  origin: "remote" | "local";
  namespaceId: string | null;
  workflowVersionId: string | null;
  versionLabel: string | null;
  workflowFingerprint: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const canonical: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      canonical[key] = canonicalize(entryValue);
    }
    return canonical;
  }
  return value;
}

/**
 * Hashes only the parsed workflow definition fields (key ordering normalized), never the
 * source file path or raw file bytes, so identical workflow content always fingerprints
 * the same way regardless of where it lives on disk.
 */
export function computeWorkflowFingerprint(definition: WorkflowDefinition): string {
  const canonical = canonicalize(definition as unknown as Record<string, unknown>);
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

export function provenanceSidecarPath(workflowFilePath: string): string {
  return `${workflowFilePath}.wfm-provenance.json`;
}

/**
 * Writes the private provenance sidecar for a freshly pulled workflow file. Best-effort:
 * callers should treat write failures as non-fatal to the pull itself.
 */
export function writeWorkflowProvenance(
  workflowFilePath: string,
  definition: WorkflowDefinition,
  remote: { namespaceId: string; workflowVersionId: string; versionLabel: string }
): void {
  const sidecar: WorkflowProvenanceSidecar = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    namespaceId: remote.namespaceId,
    workflowVersionId: remote.workflowVersionId,
    versionLabel: remote.versionLabel,
    workflowFingerprint: computeWorkflowFingerprint(definition),
  };
  const sidecarPath = provenanceSidecarPath(workflowFilePath);
  fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(sidecarPath, 0o600);
  } catch {
    // Best-effort: platforms without POSIX permission bits (e.g. some Windows filesystems)
    // will silently keep their default ACL; the sidecar still contains no secrets.
  }
}

function isValidSidecar(value: unknown): value is WorkflowProvenanceSidecar {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === PROVENANCE_SCHEMA_VERSION &&
    typeof v.namespaceId === "string" &&
    v.namespaceId.length > 0 &&
    typeof v.workflowVersionId === "string" &&
    v.workflowVersionId.length > 0 &&
    typeof v.versionLabel === "string" &&
    typeof v.workflowFingerprint === "string"
  );
}

const UNATTRIBUTED = { origin: "local" as const, namespaceId: null, workflowVersionId: null, versionLabel: null };

/**
 * Resolves provenance for a workflow file about to run. A missing, unreadable, invalid, or
 * fingerprint-mismatched sidecar is always treated as "local" rather than as an error — a
 * hand-authored or locally modified workflow must never block a run or be misattributed to
 * a remote creator/version it no longer matches.
 */
export function resolveWorkflowProvenance(workflowFilePath: string, definition: WorkflowDefinition): ResolvedWorkflowProvenance {
  const workflowFingerprint = computeWorkflowFingerprint(definition);
  const sidecarPath = provenanceSidecarPath(workflowFilePath);

  try {
    if (!fs.existsSync(sidecarPath)) {
      return { ...UNATTRIBUTED, workflowFingerprint };
    }

    const raw = fs.readFileSync(sidecarPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSidecar(parsed) || parsed.workflowFingerprint !== workflowFingerprint) {
      return { ...UNATTRIBUTED, workflowFingerprint };
    }

    return {
      origin: "remote",
      namespaceId: parsed.namespaceId,
      workflowVersionId: parsed.workflowVersionId,
      versionLabel: parsed.versionLabel,
      workflowFingerprint,
    };
  } catch {
    return { ...UNATTRIBUTED, workflowFingerprint };
  }
}

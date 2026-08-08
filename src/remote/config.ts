import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TelemetryPreference = "on" | "off";

export interface RemoteConfig {
  token?: string;
  telemetry?: TelemetryPreference;
}

function configRoot(): string {
  const override = process.env.WORKFLOW_MANAGER_CONFIG_DIR;
  if (override) {
    return override;
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "workflow-manager");
  }

  return path.join(os.homedir(), ".config", "workflow-manager");
}

export function configFilePath(): string {
  return path.join(configRoot(), "config.json");
}

export function loadRemoteConfig(): RemoteConfig {
  const filePath = configFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as RemoteConfig;
  return typeof parsed === "object" && parsed ? parsed : {};
}

export function saveRemoteConfig(config: RemoteConfig): void {
  const filePath = configFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function clearRemoteConfig(): void {
  const filePath = configFilePath();
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

export function resolveAuthToken(): string | undefined {
  return process.env.WORKFLOW_MANAGER_TOKEN ?? loadRemoteConfig().token;
}

function normalizeTelemetryValue(value: string | undefined): TelemetryPreference | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "on") return "on";
  return undefined;
}

/**
 * Telemetry is default-enabled for authenticated runs. Precedence: the WFM_TELEMETRY
 * env var always wins (for CI/one-off overrides), then the persisted `wfm telemetry
 * on|off` preference, then the "on" default. This never reads workflow files, so
 * telemetry preference can never travel with (or be forced by) a workflow definition.
 */
export function resolveTelemetryPreference(): TelemetryPreference {
  return normalizeTelemetryValue(process.env.WFM_TELEMETRY) ?? normalizeTelemetryValue(loadRemoteConfig().telemetry) ?? "on";
}

export function setPersistedTelemetryPreference(preference: TelemetryPreference): void {
  saveRemoteConfig({ ...loadRemoteConfig(), telemetry: preference });
}

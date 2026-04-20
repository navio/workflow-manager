import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RemoteConfig {
  token?: string;
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

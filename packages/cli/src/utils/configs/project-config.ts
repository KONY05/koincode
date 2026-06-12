import { mkdirSync, readFileSync, writeFileSync } from "fs";

import type { PermissionKey } from "../permissions";
import {
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_FILE,
  type HooksConfig,
  type McpServerConfig,
} from "@koincode/shared";

type ProjectConfig = {
  permissions?: Partial<Record<PermissionKey, "allowed">>;
  sensitivePatterns?: string[];
  hooks?: HooksConfig;
  mcpServers?: Record<string, McpServerConfig>;
};

function getPaths() {
  return { dir: PROJECT_CONFIG_DIR, file: PROJECT_CONFIG_FILE };
}

export function readProjectConfig(): ProjectConfig {
  try {
    return JSON.parse(readFileSync(getPaths().file, "utf8")) as ProjectConfig;
  } catch {
    return {};
  }
}

export function isPermittedForProject(key: PermissionKey): boolean {
  return readProjectConfig().permissions?.[key] === "allowed";
}

export function writeProjectConfig(config: ProjectConfig): void {
  const { dir, file } = getPaths();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2));
}

export function allowForProject(key: PermissionKey): void {
  try {
    const config = readProjectConfig();
    const next: ProjectConfig = {
      ...config,
      permissions: { ...config.permissions, [key]: "allowed" },
    };
    writeProjectConfig(next);
  } catch {
    // Degrades to "allow once" — the tool still runs, the decision just isn't persisted.
  }
}

import { mkdirSync, readFileSync, writeFileSync } from "fs";

import type { PermissionKey } from "../permissions";
import {
  Mode,
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_FILE,
  type AgentId,
  type HooksConfig,
  type McpServerConfig,
} from "@koincode/shared";

type ProjectConfig = {
  /** Legacy flat grants, written before permissions were scoped per agent
   *  (Feature 54, Decision 9). Still read — see `isPermittedForProject` — but only
   *  ever applied to built-in agents, since built-ins were the only agents that
   *  existed when these were granted. Never written to again. */
  permissions?: Partial<Record<PermissionKey, "allowed">>;
  /** Grants scoped by agent id. A grant earned under one agent must not silently
   *  apply under another with a stricter posture. */
  agentPermissions?: Record<string, Partial<Record<PermissionKey, "allowed">>>;
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

/**
 * Whether `key` is pre-approved for this project *under `agentId`*.
 *
 * The scoping is the point (Decision 9): before agents existed, a project grant was
 * unambiguous because BUILD and PLAN could never disagree — PLAN never surfaced a
 * shell prompt at all. Once agents can have different permission postures, an
 * unscoped grant earned under a permissive agent would silently apply inside a
 * locked-down one. Legacy flat grants are honoured only for built-in agents, which
 * is the exact posture they were granted under.
 */
export function isPermittedForProject(
  key: PermissionKey,
  agentId: AgentId = Mode.BUILD,
): boolean {
  const config = readProjectConfig();

  if (config.agentPermissions?.[agentId]?.[key] === "allowed") return true;

  const isBuiltin = agentId === Mode.BUILD || agentId === Mode.PLAN;
  return isBuiltin && config.permissions?.[key] === "allowed";
}

export function writeProjectConfig(config: ProjectConfig): void {
  const { dir, file } = getPaths();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2));
}

export function allowForProject(key: PermissionKey, agentId: AgentId = Mode.BUILD): void {
  try {
    const config = readProjectConfig();
    const next: ProjectConfig = {
      ...config,
      agentPermissions: {
        ...config.agentPermissions,
        [agentId]: { ...config.agentPermissions?.[agentId], [key]: "allowed" },
      },
    };
    writeProjectConfig(next);
  } catch {
    // Degrades to "allow once" — the tool still runs, the decision just isn't persisted.
  }
}

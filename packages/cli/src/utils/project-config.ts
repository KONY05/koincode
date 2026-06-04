import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import type { PermissionKey } from "../utils/permissions";
import type { HooksConfig } from "@koincode/shared";

type ProjectConfig = {
  permissions?: Partial<Record<PermissionKey, "allowed">>;
  sensitivePatterns?: string[];
  hooks?: HooksConfig;
};

function getPaths() {
  const dir = join(process.cwd(), ".koincode");
  return { dir, file: join(dir, "config.json") };
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

export function allowForProject(key: PermissionKey): void {
  try {
    const config = readProjectConfig();
    const next: ProjectConfig = {
      ...config,
      permissions: { ...config.permissions, [key]: "allowed" },
    };
    const { dir, file } = getPaths();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2));
  } catch {
    // Degrades to "allow once" — the tool still runs, the decision just isn't persisted.
  }
}

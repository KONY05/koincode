import fs from "fs";

import { CONFIG_DIR, CONFIG_FILE } from "@koincode/shared";
import type { ApiKeys, KoincodeConfig } from "@koincode/shared";

export function readConfig(): KoincodeConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as KoincodeConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: KoincodeConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function updateConfig(updates: Partial<KoincodeConfig>): KoincodeConfig {
  const current = readConfig();
  const next: KoincodeConfig = { ...current };

  if (updates.themeName !== undefined) {
    if (updates.themeName === "") {
      delete next.themeName;
    } else {
      next.themeName = updates.themeName;
    }
  }

  if (updates.defaultModel !== undefined) {
    if (updates.defaultModel === "") {
      delete next.defaultModel;
    } else {
      next.defaultModel = updates.defaultModel;
    }
  }

  if (updates.autoModeSwitch !== undefined) {
    next.autoModeSwitch = updates.autoModeSwitch;
  }

  if (updates.apiKeys !== undefined) {
    const merged: ApiKeys = { ...current.apiKeys, ...updates.apiKeys };
    for (const k of Object.keys(merged) as Array<keyof ApiKeys>) {
      if (!merged[k]) delete merged[k];
    }
    if (Object.keys(merged).length === 0) {
      delete next.apiKeys;
    } else {
      next.apiKeys = merged;
    }
  }

  writeConfig(next);
  return next;
}

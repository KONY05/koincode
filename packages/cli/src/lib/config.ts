import fs from "fs";
import { CONFIG_DIR, CONFIG_FILE } from "@koincode/shared";
import type { KoincodeConfig } from "@koincode/shared";

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

  for (const k of Object.keys(updates) as Array<keyof KoincodeConfig>) {
    const value = updates[k];
    if (value === undefined || value === "") {
      delete next[k];
    } else {
      next[k] = value;
    }
  }

  writeConfig(next);
  return next;
}

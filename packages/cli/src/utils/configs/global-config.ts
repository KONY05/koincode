import fs from "fs";

import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE } from "@koincode/shared";
import type { ApiKeys, KoincodeGlobalConfig } from "@koincode/shared";

export function readGlobalConfig(): KoincodeGlobalConfig {
  let config: KoincodeGlobalConfig;
  try {
    config = JSON.parse(
      fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"),
    ) as KoincodeGlobalConfig;
  } catch {
    return {};
  }
  return migrateLegacyGeminiKey(config);
}

/**
 * One-time migration for configs written before `apiKeys.gemini` was renamed to
 * `apiKeys.google` (every other key matches its SupportedProvider value —
 * `anthropic`, `openai`, `xai` — `gemini` was the odd one out, named after the
 * model family instead of the provider). Rewrites the file in place so the server
 * process, which reads this same file independently, picks up the migrated shape
 * too — as long as the CLI runs (and thus calls this) before the server is spawned,
 * which `server-manager.ts` always does.
 */
function migrateLegacyGeminiKey(config: KoincodeGlobalConfig): KoincodeGlobalConfig {
  const rawApiKeys = config.apiKeys as (ApiKeys & { gemini?: string }) | undefined;
  const legacyKey = rawApiKeys?.gemini;
  if (!legacyKey) return config;

  const { gemini: _gemini, ...apiKeys } = rawApiKeys;
  const migrated: KoincodeGlobalConfig = {
    ...config,
    apiKeys: { ...apiKeys, google: apiKeys.google ?? legacyKey },
  };
  writeGlobalConfig(migrated);
  return migrated;
}

export function writeGlobalConfig(config: KoincodeGlobalConfig): void {
  fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function updateGlobalConfig(
  updates: Partial<KoincodeGlobalConfig>,
): KoincodeGlobalConfig {
  const current = readGlobalConfig();
  const next: KoincodeGlobalConfig = { ...current };

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

  if (updates.port !== undefined) {
    if (updates.port === 0) {
      delete next.port;
    } else {
      next.port = updates.port;
    }
  }

  if (updates.ollamaBaseURL !== undefined) {
    if (updates.ollamaBaseURL === "") {
      delete next.ollamaBaseURL;
    } else {
      next.ollamaBaseURL = updates.ollamaBaseURL;
    }
  }

  if (updates.customProviders !== undefined) {
    next.customProviders = updates.customProviders;
  }

  if (updates.customModels !== undefined) {
    next.customModels = updates.customModels;
  }

  if (updates.voiceInput !== undefined) {
    next.voiceInput = updates.voiceInput;
  }

  if (updates.infoSidebarVisible !== undefined) {
    next.infoSidebarVisible = updates.infoSidebarVisible;
  }

  if (updates.browser !== undefined) {
    next.browser = { ...current.browser, ...updates.browser };
  }

  if (updates.whisperBackend !== undefined) {
    if (!updates.whisperBackend) {
      delete next.whisperBackend;
    } else {
      next.whisperBackend = updates.whisperBackend;
    }
  }

  if (updates.telemetry !== undefined) {
    next.telemetry = updates.telemetry;
  }

  if (updates.notificationEnabled !== undefined) {
    next.notificationEnabled = updates.notificationEnabled;
  }

  writeGlobalConfig(next);
  return next;
}

import fs from "fs";

import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE } from "@koincode/shared";
import type { ApiKeys, KoincodeGlobalConfig } from "@koincode/shared";

export function readGlobalConfig(): KoincodeGlobalConfig {
  try {
    return JSON.parse(
      fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"),
    ) as KoincodeGlobalConfig;
  } catch {
    return {};
  }
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

  if (updates.localModels !== undefined) {
    next.localModels = updates.localModels;
  }

  if (updates.voiceInput !== undefined) {
    next.voiceInput = updates.voiceInput;
  }

  if (updates.whisperModel !== undefined) {
    if (!updates.whisperModel) {
      delete next.whisperModel;
    } else {
      next.whisperModel = updates.whisperModel;
    }
  }

  if (updates.whisperBackend !== undefined) {
    if (!updates.whisperBackend) {
      delete next.whisperBackend;
    } else {
      next.whisperBackend = updates.whisperBackend;
    }
  }

  writeGlobalConfig(next);
  return next;
}

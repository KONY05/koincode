import fs from "fs";

import {
  DEFAULT_OLLAMA_BASE_URL,
  GLOBAL_CONFIG_FILE,
  type KoincodeGlobalConfig,
} from "@koincode/shared";

export function resolveOllamaBaseURL(): string {
  try {
    const config = JSON.parse(
      fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"),
    ) as KoincodeGlobalConfig;
    return config.ollamaBaseURL ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  } catch {
    return process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  }
}

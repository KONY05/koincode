import fs from "fs";
import { Hono } from "hono";

import { GLOBAL_CONFIG_FILE, type KoincodeGlobalConfig, type LocalModelsResponse } from "@koincode/shared";
import { resolveOllamaBaseURL } from "../lib/ollama";

type OllamaTagsResponse = {
  models?: Array<{ name: string; size?: number }>;
};

const app = new Hono().get("/", async (c) => {
  // Auto-detect Ollama
  let ollamaModels: LocalModelsResponse["ollama"] = null;
  try {
    const base = resolveOllamaBaseURL();
    const response = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = (await response.json()) as OllamaTagsResponse;
      ollamaModels = (data.models ?? []).map((m) => ({
        id: `ollama/${m.name}`,
        name: m.name,
        size: m.size,
      }));
    }
  } catch {
    // Ollama not running or unreachable — leave as null
  }

  // Read user-configured custom local models from global config
  let customModels: LocalModelsResponse["custom"] = [];
  try {
    const config = JSON.parse(
      fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"),
    ) as KoincodeGlobalConfig;
    customModels = config.localModels ?? [];
  } catch {
    // No config file yet
  }

  return c.json<LocalModelsResponse>({ ollama: ollamaModels, custom: customModels });
});

export default app;

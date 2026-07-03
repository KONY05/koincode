import { Hono } from "hono";

import type { OllamaModelsResponse } from "@koincode/shared";
import { resolveOllamaBaseURL } from "../lib/ollama";

type OllamaTagsResponse = {
  models?: Array<{ name: string; size?: number }>;
};

const app = new Hono().get("/", async (c) => {
  let ollamaModels: OllamaModelsResponse["ollama"] = null;
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

  return c.json<OllamaModelsResponse>({ ollama: ollamaModels });
});

export default app;

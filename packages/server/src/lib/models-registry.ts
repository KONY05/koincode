import fs from "fs/promises";
import path from "path";

import {
  SUPPORTED_CHAT_MODELS,
  enrichModelWithModelsDevData,
  findSupportedChatModel as findSupportedChatModelBase,
  getContextWindow as getContextWindowBase,
  isVisionModel as isVisionModelBase,
  getReasoningEffortLevels as getReasoningEffortLevelsBase,
  GLOBAL_CONFIG_DIR,
  type ModelsDevApiResponse,
  type SupportedChatModelDefinition,
  type ReasoningEffortLevel,
} from "@koincode/shared";

const DEFAULT_MODELS_DEV_API_URL = "https://models.dev/api.json";
const DEFAULT_MODELS_DEV_CACHE_FILE = path.join(GLOBAL_CONFIG_DIR, "models-dev.json");
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let modelsDevApiData: ModelsDevApiResponse | null = null;
let enrichedModelsCache: SupportedChatModelDefinition[] | null = null;
let refreshTimer: Timer | NodeJS.Timeout | null = null;

/** Where the fetched payload is persisted so it survives server restarts (env-overridable for tests). */
function modelsDevCacheFile(): string {
  return process.env.MODELS_DEV_CACHE_FILE || DEFAULT_MODELS_DEV_CACHE_FILE;
}

function applyModelsDevData(data: ModelsDevApiResponse): void {
  modelsDevApiData = data;
  enrichedModelsCache = SUPPORTED_CHAT_MODELS.map((model) =>
    enrichModelWithModelsDevData(model, data),
  );
}

/** Writes the payload to disk atomically (temp file + rename). Best-effort — never fatal. */
async function persistModelsDevToDisk(data: ModelsDevApiResponse): Promise<void> {
  try {
    const file = modelsDevCacheFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  } catch {
    // Non-fatal — failing to cache merely means the next boot re-fetches.
  }
}

export async function fetchModelsDevRegistry(
  apiUrl: string = process.env.MODELS_DEV_API_URL || DEFAULT_MODELS_DEV_API_URL,
): Promise<ModelsDevApiResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[ModelsDevRegistry] Fetch failed with status ${res.status}`);
      return null;
    }

    const data = (await res.json()) as ModelsDevApiResponse;
    if (data && typeof data === "object") {
      applyModelsDevData(data);
      await persistModelsDevToDisk(data);
      return data;
    }
    return null;
  } catch (err) {
    console.warn(
      `[ModelsDevRegistry] Failed to fetch models.dev registry from ${apiUrl}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Loads the cached payload from disk when present and still fresh (within the 24h TTL).
 * Returns null when the file is missing, stale, or malformed — the caller then re-fetches.
 */
async function loadModelsDevFromDisk(): Promise<ModelsDevApiResponse | null> {
  try {
    const file = modelsDevCacheFile();
    const stat = await fs.stat(file);
    
    if (Date.now() - stat.mtimeMs > REFRESH_INTERVAL_MS) return null; // stale

    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as ModelsDevApiResponse;

    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function ensureRefreshTimer(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    fetchModelsDevRegistry().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if ("unref" in refreshTimer && typeof refreshTimer.unref === "function") {
    (refreshTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Initializes the models.dev registry service asynchronously.
 * Boots fast from a fresh on-disk cache; otherwise fetches. Either way a periodic background
 * refresh keeps the in-memory and disk copies current without blocking startup.
 */
export function initModelsDevRegistry(): Promise<void> {
  ensureRefreshTimer();

  return (async () => {
    const cached = await loadModelsDevFromDisk();
    if (cached) applyModelsDevData(cached);

    // Only revalidate over the network when we have nothing fresh on disk. A fresh cache
    // means we don't hit models.dev again until the 24h interval fires — this decouples how
    // often we fetch from how often the server restarts.
    if (!cached) {
      await fetchModelsDevRegistry().catch(() => {});
    }
  })();
}

/**
 * Returns the current enriched list of supported chat models.
 * Falls back to static SUPPORTED_CHAT_MODELS if no models.dev data is loaded yet or failed.
 */
export function getEnrichedSupportedChatModels(): readonly SupportedChatModelDefinition[] {
  if (enrichedModelsCache) {
    return enrichedModelsCache;
  }
  return SUPPORTED_CHAT_MODELS;
}

/** Look up a supported model by ID from the enriched registry. */
export function findEnrichedSupportedChatModel(modelId: string): SupportedChatModelDefinition | undefined {
  return findSupportedChatModelBase(modelId, getEnrichedSupportedChatModels());
}

/** Returns the context window size from the enriched model registry. */
export function getEnrichedContextWindow(modelId: string): number {
  return getContextWindowBase(modelId, getEnrichedSupportedChatModels());
}

/** Returns true if the model supports vision from the enriched model registry. */
export function isEnrichedVisionModel(modelId: string): boolean {
  return isVisionModelBase(modelId, getEnrichedSupportedChatModels());
}

/** Returns reasoning effort levels for a model from the enriched model registry. */
export function getEnrichedReasoningEffortLevels(modelId: string): readonly ReasoningEffortLevel[] | null {
  return getReasoningEffortLevelsBase(modelId, getEnrichedSupportedChatModels());
}

/** Returns the raw models.dev API response, or null if not yet loaded or load failed. */
export function getModelsDevApiData(): ModelsDevApiResponse | null {
  return modelsDevApiData;
}

/** Resets the registry cache (and any refresh timer) for testing purposes. */
// export function resetModelsDevRegistryCache(): void {
//   modelsDevApiData = null;
//   enrichedModelsCache = null;
//   if (refreshTimer) {
//     clearInterval(refreshTimer);
//     refreshTimer = null;
//   }
// }

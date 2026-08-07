import {
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
  getContextWindow,
  getReasoningEffortLevels,
  isVisionModel,
  type ModelPricing,
  type SupportedChatModelDefinition,
} from "@koincode/shared";

import { apiClient, fetchWithRestart } from "./api-client";

let cachedModels: readonly SupportedChatModelDefinition[] | null = null;
let fetchPromise: Promise<readonly SupportedChatModelDefinition[]> | null = null;

// Bound the prefetch so a hung server connection can't stall CLI startup. It's best-effort —
// static models are the fallback — so never block boot waiting on it.
const MODELS_PREFETCH_TIMEOUT_MS = 5000;

/** Returns the cached enriched model list, or static fallbacks if not yet fetched. */
export function getChatModelsList(): readonly SupportedChatModelDefinition[] {
  return cachedModels ?? SUPPORTED_CHAT_MODELS;
}

/** Prefetch enriched models from the server `/models` endpoint (non-fatal on failure). */
export async function prefetchEnrichedModels(): Promise<void> {
  if (cachedModels) return;
  if (!fetchPromise) {
    fetchPromise = fetchEnrichedModels();
  }
  await fetchPromise;
}

async function fetchEnrichedModels(): Promise<readonly SupportedChatModelDefinition[]> {
  try {
    const res = await apiClient.models.$get({}, {
      fetch: (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => fetchWithRestart(input, { ...init, signal: AbortSignal.timeout(MODELS_PREFETCH_TIMEOUT_MS) }),
    });
    if (!res.ok) return SUPPORTED_CHAT_MODELS;
    const data = (await res.json()) as { models?: SupportedChatModelDefinition[] };
    if (Array.isArray(data.models) && data.models.length > 0) {
      cachedModels = data.models;
      return cachedModels;
    }
  } catch {
    // Server unreachable or response malformed — static registry is the fallback.
  }
  return SUPPORTED_CHAT_MODELS;
}

export function findChatModel(modelId: string): SupportedChatModelDefinition | undefined {
  return findSupportedChatModel(modelId, getChatModelsList());
}

export function getChatModelPricing(modelId: string): ModelPricing | undefined {
  return findChatModel(modelId)?.pricing;
}

export function getChatContextWindow(modelId: string): number {
  return getContextWindow(modelId, getChatModelsList());
}

export function isChatVisionModel(modelId: string): boolean {
  return isVisionModel(modelId, getChatModelsList());
}

export function getChatReasoningEffortLevels(modelId: string) {
  return getReasoningEffortLevels(modelId, getChatModelsList());
}


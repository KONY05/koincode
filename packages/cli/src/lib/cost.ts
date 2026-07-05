import type { UIMessage } from "ai";

import { findSupportedChatModel, type ChatMessageMetadata, type ModelPricing } from "@koincode/shared";
import { listCustomModels } from "./custom-models";

type UsageMessage = Pick<UIMessage<ChatMessageMetadata>, "role" | "metadata">;

export function getModelPricing(modelId: string): ModelPricing | undefined {
  const builtIn = findSupportedChatModel(modelId);
  if (builtIn) return builtIn.pricing;
  if (!modelId.startsWith("custom/")) return undefined;
  return listCustomModels().find((m) => m.id === modelId)?.pricing;
}

// Anthropic's ephemeral (5-minute) prompt-cache multipliers, applied to the model's
// base input rate — a cache write costs a premium, a cache read is heavily discounted.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Sums cost across every assistant turn using the pricing of the model that produced it. */
export function estimateSessionCost(messages: UsageMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const usage = msg.metadata?.usage;
    const modelId = msg.metadata?.model;
    if (!usage || !modelId) continue;

    const pricing = getModelPricing(String(modelId));
    if (!pricing) continue;

    const outputTokens = usage.outputTokens ?? 0;
    const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    // Providers that don't report the cache breakdown (non-Anthropic models, or
    // turns saved before caching shipped) leave these undefined — fall back to
    // treating the whole input total as uncached, matching prior behavior exactly.
    const noCacheTokens =
      usage.inputTokenDetails?.noCacheTokens ??
      Math.max((usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens, 0);

    total +=
      (noCacheTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
      (cacheReadTokens / 1_000_000) * pricing.inputUsdPerMillionTokens * CACHE_READ_MULTIPLIER +
      (cacheWriteTokens / 1_000_000) * pricing.inputUsdPerMillionTokens * CACHE_WRITE_MULTIPLIER +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;
  }
  return total;
}

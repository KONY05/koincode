import type { UIMessage } from "ai";

import { getChatModelPricing } from "./enriched-models";
import type { ChatMessageMetadata, ModelPricing } from "@koincode/shared";
import { listCustomModels } from "./custom-models";

type UsageMessage = Pick<UIMessage<ChatMessageMetadata>, "role" | "metadata">;

export function getModelPricing(modelId: string, metadataPricing?: ModelPricing): ModelPricing | undefined {
  if (metadataPricing) return metadataPricing;
  const modelPricing = getChatModelPricing(modelId);
  if (modelPricing) return modelPricing;
  if (!modelId.startsWith("custom/")) return undefined;
  return listCustomModels().find((m) => m.id === modelId)?.pricing;
}

/** Sums cost across every assistant turn using the pricing of the model that produced it. */
export function estimateSessionCost(messages: UsageMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const usage = msg.metadata?.usage;
    const modelId = msg.metadata?.model;
    if (!usage || !modelId) continue;

    const pricing = getModelPricing(String(modelId), msg.metadata?.pricing);
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

    // Use absolute cache rates from models.dev when available. When absent (old messages
    // or providers that don't report cache pricing), treat cache tokens as regular input
    // tokens — a conservative fallback that slightly overstates cost rather than understating.
    const cacheReadRate = pricing.cacheReadUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens;
    const cacheWriteRate = pricing.cacheWriteUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens;

    total +=
      (noCacheTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
      (cacheReadTokens / 1_000_000) * cacheReadRate +
      (cacheWriteTokens / 1_000_000) * cacheWriteRate +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;
  }
  return total;
}

import type { UIMessage } from "ai";

import { getChatModelPricing } from "./enriched-models";
import type { AuxCostEntry, ChatMessageMetadata, ModelPricing } from "@koincode/shared";
import { listCustomModels } from "./custom-models";

type UsageMessage = Pick<UIMessage<ChatMessageMetadata>, "role" | "metadata">;

export function getModelPricing(modelId: string, metadataPricing?: ModelPricing): ModelPricing | undefined {
  if (metadataPricing) return metadataPricing;
  const modelPricing = getChatModelPricing(modelId);
  if (modelPricing) return modelPricing;
  if (!modelId.startsWith("custom/")) return undefined;
  return listCustomModels().find((m) => m.id === modelId)?.pricing;
}

/** Picks the rates that apply to one assistant turn. Providers bill long-context tiers on
 *  the WHOLE request once the prompt crosses the threshold (not just the tokens above it),
 *  so the turn's prompt total — `usage.inputTokens`, cached tokens included — selects the
 *  tier. Tiers are ascending by threshold; the last match is the highest applicable band. */
function resolveTurnPricing(pricing: ModelPricing, promptTokens: number): ModelPricing {
  let effective = pricing;
  for (const tier of pricing.tiers ?? []) {
    if (promptTokens > tier.aboveTokens) effective = tier;
  }
  return effective;
}

/** Sums cost across every assistant turn using the pricing of the model that produced it. */
export function estimateSessionCost(messages: UsageMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const usage = msg.metadata?.usage;
    const modelId = msg.metadata?.model;
    if (!usage || !modelId) continue;

    const basePricing = getModelPricing(String(modelId), msg.metadata?.pricing);
    if (!basePricing) continue;

    const outputTokens = usage.outputTokens ?? 0;
    const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    // Providers that don't report the cache breakdown (non-Anthropic models, or
    // turns saved before caching shipped) leave these undefined — fall back to
    // treating the whole input total as uncached, matching prior behavior exactly.
    const noCacheTokens =
      usage.inputTokenDetails?.noCacheTokens ??
      Math.max((usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens, 0);

    // Long-context tier selection uses the full prompt total even when the provider
    // didn't report a per-bucket breakdown.
    const pricing = resolveTurnPricing(basePricing, usage.inputTokens ?? 0);

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

/** Sums cost across auxiliary LLM calls (title generation, sub-agent steps) that
 *  produced no assistant message row. Each entry carries its own usage + model,
 *  so we fold them into `estimateSessionCost` as pseudo assistant messages. */
export function estimateAuxCost(entries: AuxCostEntry[]): number {
  return estimateSessionCost(
    entries.map((entry) => ({
      role: "assistant" as const,
      metadata: {
        model: entry.model,
        ...(entry.pricing ? { pricing: entry.pricing } : {}),
        usage: entry.usage,
      } as ChatMessageMetadata,
    })),
  );
}

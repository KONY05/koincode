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

    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    total +=
      (inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;
  }
  return total;
}

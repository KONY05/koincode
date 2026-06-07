import type { LocalModelConfig } from "./config";

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "local";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  contextWindow: number;
};

export const SUPPORTED_CHAT_MODELS = [
  // ── Anthropic (direct ANTHROPIC_API_KEY or OpenRouter fallback) ────────────
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 75 },
    contextWindow: 200_000,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    contextWindow: 200_000,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 0.8, outputUsdPerMillionTokens: 4 },
    contextWindow: 200_000,
  },

  // ── OpenAI (direct OPENAI_API_KEY or OpenRouter fallback) ──────────────────
  { id: "gpt-5",        provider: "openai", pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10  }, contextWindow: 1_000_000 },
  { id: "gpt-5-mini",   provider: "openai", pricing: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2   }, contextWindow:   128_000 },
  { id: "gpt-4.1",      provider: "openai", pricing: { inputUsdPerMillionTokens: 2,    outputUsdPerMillionTokens: 8   }, contextWindow: 1_000_000 },
  { id: "gpt-4.1-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.4,  outputUsdPerMillionTokens: 1.6 }, contextWindow: 1_000_000 },
  { id: "gpt-4.1-nano", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.1,  outputUsdPerMillionTokens: 0.4 }, contextWindow: 1_000_000 },
  { id: "gpt-4o",       provider: "openai", pricing: { inputUsdPerMillionTokens: 2.5,  outputUsdPerMillionTokens: 10  }, contextWindow:   128_000 },
  { id: "gpt-4o-mini",  provider: "openai", pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 }, contextWindow:   128_000 },
  { id: "o4-mini",      provider: "openai", pricing: { inputUsdPerMillionTokens: 1.1,  outputUsdPerMillionTokens: 4.4 }, contextWindow:   200_000 },
  { id: "o3",           provider: "openai", pricing: { inputUsdPerMillionTokens: 2,    outputUsdPerMillionTokens: 8   }, contextWindow:   200_000 },
  { id: "o3-mini",      provider: "openai", pricing: { inputUsdPerMillionTokens: 1.1,  outputUsdPerMillionTokens: 4.4 }, contextWindow:   200_000 },

  // ── Google (direct GOOGLE_GENERATIVE_AI_API_KEY or OpenRouter fallback) ────
  {
    id: "gemini-2.5-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 },
    contextWindow: 1_048_576,
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
    contextWindow: 1_048_576,
  },
  {
    id: "gemini-2.0-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.4 },
    contextWindow: 1_048_576,
  },

  // ── OpenRouter paid (always require OPENROUTER_API_KEY) ────────────────────
  {
    id: "deepseek/deepseek-chat-v3-0324",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.27, outputUsdPerMillionTokens: 1.1 },
    contextWindow: 128_000,
  },
  {
    id: "mistralai/mistral-large-2411",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
    contextWindow: 128_000,
  },

  // ── OpenRouter free (require OPENROUTER_API_KEY, $0 per token) ────────────
  {
    id: "openrouter/owl-alpha",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 128_000,
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 128_000,
  },
  {
    id: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 128_000,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 128_000,
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export function isLocalModelId(modelId: string): boolean {
  return modelId.startsWith("ollama/") || modelId.startsWith("local/");
}

/** Returns the context window size in tokens for a given model ID. Falls back to 128k for unknown/local models. */
export function getContextWindow(modelId: string): number {
  const model = findSupportedChatModel(modelId);
  return model?.contextWindow ?? 128_000;
}

export type LocalModelEntry = {
  id: string;
  provider: "ollama" | "local";
  displayName: string;
  size?: number;
};

export type LocalModelsResponse = {
  ollama: Array<{ id: string; name: string; size?: number }> | null;
  custom: LocalModelConfig[];
};

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "claude-sonnet-4-6";

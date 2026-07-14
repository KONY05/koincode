export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "ollama"
  | "custom";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  contextWindow: number;
  vision: boolean;
};

/**
 * Frontier and open source supported models list
 * Frontier: have 2 of every model family and a legacy fallback
 * Free (Openrouter): have the best (free) per model family
*/
export const SUPPORTED_CHAT_MODELS = [
  // ── Anthropic (direct ANTHROPIC_API_KEY or OpenRouter fallback) ────────────
  {
    id: "claude-fable-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 10, outputUsdPerMillionTokens: 50 },
    contextWindow: 1_000_000,
    vision: true,
  },
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 },
    contextWindow: 1_000_000,
    vision: true,
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 },
    contextWindow: 1_000_000,
    vision: true,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_000_000,
    vision: true,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_000_000,
    vision: true,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 },
    contextWindow: 200_000,
    vision: true,
  },

  // ── OpenAI (direct OPENAI_API_KEY or OpenRouter fallback) ──────────────────
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 30 },
    contextWindow: 1_050_000,
    vision: true,
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 2.50, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_050_000,
    vision: true,
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 6 },
    contextWindow: 1_050_000,
    vision: true,
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 30 },
    contextWindow: 1_050_000,
    vision: true,
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_050_000,
    vision: true,
  },
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 1.75, outputUsdPerMillionTokens: 14 },
    contextWindow: 400_000,
    vision: true,
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2 },
    contextWindow: 400_000,
    vision: true,
  },
  
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6 },
    contextWindow: 1_047_576,
    vision: true,
  },

  // ── Google (direct GOOGLE_GENERATIVE_AI_API_KEY or OpenRouter fallback) ────
  {
    id: "gemini-3.5-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 9 },
    contextWindow: 1_048_576,
    vision: true,
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 3 },
    contextWindow: 1_048_576,
    vision: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 12 },
    contextWindow: 1_048_576,
    vision: true,
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 2.5 },
    contextWindow: 1_048_576,
    vision: true,
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
    contextWindow: 1_048_576,
    vision: true,
  },

  // ── OpenRouter paid (always require OPENROUTER_API_KEY) ────────────────────
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.435, outputUsdPerMillionTokens: 0.87 },
    contextWindow: 1_048_576,
    vision: false,
  },
  {
    id: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.089, outputUsdPerMillionTokens: 0.18 },
    contextWindow: 1_048_576,
    vision: false,
  },
  {
    id: "moonshotai/kimi-k2.7-code",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.74, outputUsdPerMillionTokens: 3.50 },
    contextWindow: 262_144,
    vision: true,
  },
  {
    id: "moonshotai/kimi-k2.6",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.66, outputUsdPerMillionTokens: 3.41 },
    contextWindow: 262_144,
    vision: true,
  },
  {
    id: "z-ai/glm-5.2",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.93, outputUsdPerMillionTokens: 3 },
    contextWindow: 1_048_576,
    vision: false,
  },
  {
    id: "qwen/qwen3.7-plus",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.32, outputUsdPerMillionTokens: 1.28 },
    contextWindow: 1_000_000,
    vision: true,
  },
  {
    id: "qwen/qwen3.7-max",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 3.75 },
    contextWindow: 1_000_000,
    vision: false,
  },
  {
    id: "minimax/minimax-m3",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.30, outputUsdPerMillionTokens: 1.20 },
    contextWindow: 1_000_000,
    vision: true,
  },
   {
    id: "nex-agi/nex-n2-pro",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 1 },
    contextWindow: 262_144,
    vision: true,
  },

  // ── OpenRouter free (require OPENROUTER_API_KEY, $0 per token) ────────────
  {
    id: "poolside/laguna-xs-2.1:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 262_144,
    vision: false,
  },
  {
    id: "cohere/north-mini-code:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 256_000,
    vision: false,
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 262_144,
    vision: true,
  },
  {
    id: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 131_072,
    vision: false,
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 1_000_000,
    vision: false,
  }
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export function isCustomOrOllamaModelId(modelId: string): boolean {
  return modelId.startsWith("ollama/") || modelId.startsWith("custom/");
}

/** Returns the context window size in tokens for a given model ID. Falls back to 128k for unknown/local models. */
export function getContextWindow(modelId: string): number {
  const model = findSupportedChatModel(modelId);
  return model?.contextWindow ?? 128_000;
}

/** Returns true if the model supports image inputs (vision). Falls back to false for unknown/local models. */
export function isVisionModel(modelId: string): boolean {
  const model = findSupportedChatModel(modelId);
  return model?.vision ?? false;
}

export type OllamaModelsResponse = {
  ollama: Array<{ id: string; name: string; size?: number }> | null;
};

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "claude-sonnet-5";

export const FALLBACK_MODEL_ID: SupportedChatModelId = "nvidia/nemotron-3-ultra-550b-a55b:free";

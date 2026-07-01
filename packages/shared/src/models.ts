import type { LocalModelConfig } from "./config";

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
  | "local";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  contextWindow: number;
  vision: boolean;
};

export const SUPPORTED_CHAT_MODELS = [
  // ── Anthropic (direct ANTHROPIC_API_KEY or OpenRouter fallback) ────────────
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
    id: "claude-opus-4-6",
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
    id: "gpt-5",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
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
    id: "gpt-5.3-codex",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 1.75, outputUsdPerMillionTokens: 14 },
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
    id: "moonshotai/kimi-k2.7-code",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.74, outputUsdPerMillionTokens: 3.50 },
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
    id: "qwen/qwen3.7-max",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 3.75 },
    contextWindow: 1_000_000,
    vision: false,
  },

  // ── OpenRouter free (require OPENROUTER_API_KEY, $0 per token) ────────────
  {
    id: "openrouter/owl-alpha",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 1_048_756,
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
  },
  // {
  //   id: "nex-agi/nex-n2-pro:free",
  //   provider: "openrouter",
  //   pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  //   contextWindow: 262_144,
  //   vision: true,
  // },
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

/** Returns true if the model supports image inputs (vision). Falls back to false for unknown/local models. */
export function isVisionModel(modelId: string): boolean {
  const model = findSupportedChatModel(modelId);
  return model?.vision ?? false;
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

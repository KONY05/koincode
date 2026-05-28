export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "anthropic" | "openai" | "google" | "openrouter";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
  // ── Anthropic (direct ANTHROPIC_API_KEY or OpenRouter fallback) ────────────
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 75 },
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 0.8, outputUsdPerMillionTokens: 4 },
  },

  // ── OpenAI (direct OPENAI_API_KEY or OpenRouter fallback) ──────────────────
  { id: "gpt-5",       provider: "openai", pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10   } },
  { id: "gpt-5-mini",  provider: "openai", pricing: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2    } },
  { id: "gpt-4.1",     provider: "openai", pricing: { inputUsdPerMillionTokens: 2,    outputUsdPerMillionTokens: 8    } },
  { id: "gpt-4.1-mini",provider: "openai", pricing: { inputUsdPerMillionTokens: 0.4,  outputUsdPerMillionTokens: 1.6  } },
  { id: "gpt-4.1-nano",provider: "openai", pricing: { inputUsdPerMillionTokens: 0.1,  outputUsdPerMillionTokens: 0.4  } },
  { id: "gpt-4o",      provider: "openai", pricing: { inputUsdPerMillionTokens: 2.5,  outputUsdPerMillionTokens: 10   } },
  { id: "gpt-4o-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6  } },
  { id: "o4-mini",     provider: "openai", pricing: { inputUsdPerMillionTokens: 1.1,  outputUsdPerMillionTokens: 4.4  } },
  { id: "o3",          provider: "openai", pricing: { inputUsdPerMillionTokens: 2,    outputUsdPerMillionTokens: 8    } },
  { id: "o3-mini",     provider: "openai", pricing: { inputUsdPerMillionTokens: 1.1,  outputUsdPerMillionTokens: 4.4  } },

  // ── Google (direct GOOGLE_GENERATIVE_AI_API_KEY or OpenRouter fallback) ────
  {
    id: "gemini-2.5-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 },
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
  },
  {
    id: "gemini-2.0-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.4 },
  },

  // ── OpenRouter paid (always require OPENROUTER_API_KEY) ────────────────────
  {
    id: "deepseek/deepseek-chat-v3-0324",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.27, outputUsdPerMillionTokens: 1.1 },
  },
  {
    id: "mistralai/mistral-large-2411",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
  },

  // ── OpenRouter free (require OPENROUTER_API_KEY, $0 per token) ────────────
  {
    id: "qwen/qwen3-coder:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
  {
    id: "moonshotai/kimi-k2.6:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "claude-opus-4-6";

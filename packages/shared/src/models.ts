export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  /** Absolute cache token rates sourced from models.dev at request time.
   * Optional — only present when the provider reports cache pricing and
   * models.dev has fetched successfully. When absent, cache tokens are
   * treated as regular input tokens in cost calculations. */
  cacheReadUsdPerMillionTokens?: number;
  cacheWriteUsdPerMillionTokens?: number;
};

export type SupportedProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "openrouter"
  | "ollama"
  | "custom";

/** UI-facing reasoning effort levels. Server-side, each provider maps these onto its own
 * mechanism (adaptive effort, thinking budget tokens, native reasoningEffort, etc.) —
 * see packages/server/src/lib/models.ts. Per-model support varies — see the
 * `reasoningEffort` array on each model entry below for what a given model actually accepts.
 * ("none" is deliberately not modeled — it means "disable reasoning entirely," a different
 * concept than an effort *level*, and every reasoning-capable model here already ships with
 * reasoning on by default.)
 *
 * Single source of truth: the request-body Zod schema (`packages/server/src/routes/chat.ts`)
 * builds its `reasoningEffort` enum straight from `REASONING_EFFORT_LEVELS` below rather than
 * re-listing these values, so the two can't drift out of sync. */
export const REASONING_EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];

export type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  contextWindow: number;
  vision: boolean;
  /** Clean display name shown in the status bar, models dialog, and message footers instead of the raw id. */
  label: string;
  /** Which reasoning effort levels this model accepts. Absent = no reasoning effort control for this model. */
  reasoningEffort?: readonly ReasoningEffortLevel[];
};

export type ModelsDevModelEntry = {
  id?: string;
  name?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{
    type?: string;
    values?: string[];
    min?: number;
    max?: number;
  }>;
  modalities?: {
    input?: string[];
    output?: string[];
  };
};

export type ModelsDevApiProviderEntry = {
  id?: string;
  name?: string;
  models?: Record<string, ModelsDevModelEntry>;
};

export type ModelsDevApiResponse = Record<string, ModelsDevApiProviderEntry>;

// Confirmed per-model against ai-sdk.dev's provider docs (see links in
// context/feature-specs/44-reasoning-effort-model-label.md) — kept conservative where the
// docs didn't name a specific model, rather than guessing and risking a 400 at request time.
const STANDARD_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = ["low", "medium", "high"];
const KIMI3_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = ["low", "high", "max"];
// GPT-5.6 explicitly confirmed to support the full range (ai-sdk.dev/providers/ai-sdk-providers/openai).
const GPT_5_6_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
// claude-opus-4-7/4-8, claude-fable-5, and claude-sonnet-5 confirmed to additionally support
// "xhigh" beyond the base low/medium/high (ai-sdk.dev/providers/ai-sdk-providers/anthropic#reasoning).
const CLAUDE_XHIGH_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = ["low", "medium", "high", "xhigh"];
// claude-opus-5 goes one further than the rest of the Claude 5 generation, adding "max" as its
// top effort tier (confirmed via Anthropic's official docs: platform.claude.com/docs/en/about-claude/
// models/whats-new-opus-5#effort-matters-more — "The full ladder is available: low, medium, high,
// xhigh, and max, with max as the top tier for the deepest possible reasoning.").
const CLAUDE_OPUS_5_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
// The Gemini 3 Flash family confirmed to additionally support "minimal"
// (ai-sdk.dev/providers/ai-sdk-providers/google#language-models); Gemini 3.1 Pro does not.
const GEMINI_3_FLASH_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = ["minimal", "low", "medium", "high"];

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
    label: "Claude Fable 5",
    reasoningEffort: CLAUDE_XHIGH_EFFORT_LEVELS,
  },
  {
    id: "claude-opus-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Claude Opus 5",
    reasoningEffort: CLAUDE_OPUS_5_EFFORT_LEVELS,
  },
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Claude Opus 4.8",
    reasoningEffort: CLAUDE_XHIGH_EFFORT_LEVELS,
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Claude Opus 4.7",
    reasoningEffort: CLAUDE_XHIGH_EFFORT_LEVELS,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Claude Sonnet 5",
    reasoningEffort: CLAUDE_XHIGH_EFFORT_LEVELS,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Claude Sonnet 4.6",
    // Unconfirmed whether this model exposes a manual `effort` dial at all vs. pure automatic
    // adaptive reasoning — docs describe "adaptive" for this generation without naming an
    // effort parameter explicitly the way they do for opus-4-7/4-8/sonnet-5. Kept at the safe
    // standard set rather than assuming it doesn't work; flagged in the spec as unconfirmed.
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 },
    contextWindow: 200_000,
    vision: true,
    label: "Claude Haiku 4.5",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },

  // ── OpenAI (direct OPENAI_API_KEY or OpenRouter fallback) ──────────────────
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 30 },
    contextWindow: 1_050_000,
    vision: true,
    label: "GPT-5.6 Sol",
    reasoningEffort: GPT_5_6_EFFORT_LEVELS,
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 2.50, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_050_000,
    vision: true,
    label: "GPT-5.6 Terra",
    reasoningEffort: GPT_5_6_EFFORT_LEVELS,
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 6 },
    contextWindow: 1_050_000,
    vision: true,
    label: "GPT-5.6 Luna",
    reasoningEffort: GPT_5_6_EFFORT_LEVELS,
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 30 },
    contextWindow: 1_050_000,
    vision: true,
    label: "GPT-5.5",
    // Docs confirm only that the full range applies to GPT-5.6; older gpt-5.x variants are
    // noted as "varies by model" without naming specifics — kept at the safe standard set.
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 15 },
    contextWindow: 1_050_000,
    vision: true,
    label: "GPT-5.4",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 1.75, outputUsdPerMillionTokens: 14 },
    contextWindow: 400_000,
    vision: true,
    label: "GPT-5.3 Codex",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2 },
    contextWindow: 400_000,
    vision: true,
    label: "GPT-5 Mini",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },

  {
    id: "gpt-4.1-mini",
    provider: "openai",
    pricing: { inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6 },
    contextWindow: 1_047_576,
    vision: true,
    label: "GPT-4.1 Mini",
    reasoningEffort: undefined,
  },

  // ── Google (direct GOOGLE_GENERATIVE_AI_API_KEY or OpenRouter fallback) ────
  {
    id: "gemini-3.5-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 9 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Gemini 3.5 Flash",
    reasoningEffort: GEMINI_3_FLASH_EFFORT_LEVELS,
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 3 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Gemini 3 Flash (Preview)",
    reasoningEffort: GEMINI_3_FLASH_EFFORT_LEVELS,
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 12 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Gemini 3.1 Pro (Preview)",
    // Confirmed low/medium/high only — no "minimal" (unlike the Gemini 3 Flash family).
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 2.5 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Gemini 2.5 Flash",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Gemini 2.5 Pro",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },

  // ── xAI (direct XAI_API_KEY or OpenRouter fallback) ────────────────────────
  {
    id: "grok-4.5",
    provider: "xai",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
    contextWindow: 500_000,
    vision: true,
    label: "Grok 4.5",
    // xAI's own reasoningEffort ceiling is "high" — no xhigh/max tier exists for this provider.
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },

  // ── OpenRouter paid (always require OPENROUTER_API_KEY) ────────────────────
  {
    id: "moonshotai/kimi-k3",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 2.90, outputUsdPerMillionTokens: 14 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Kimi K3",
    // Real Kimi K2 splits reasoning into a separate "Kimi K2 Thinking" SKU — the base
    // (non-"-thinking") line isn't reasoning-branded, so left unsupported rather than guessed.
    reasoningEffort: KIMI3_EFFORT_LEVELS,
  },
  {
    id: "qwen/qwen3.8-max",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Qwen3.8 Max",
    // Qwen3.5+ ship hybrid thinking enabled by default (Qwen docs).
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "z-ai/glm-5.2",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.93, outputUsdPerMillionTokens: 3 },
    contextWindow: 1_048_576,
    vision: false,
    label: "GLM 5.2",
    // GLM-4.5/4.6 ship hybrid thinking mode enabled by default (Zhipu AI docs) — real family
    // this fictional version continues, routed through OpenRouter's unified effort→budget mapping.
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "meta/muse-spark-1.1",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 4.25 },
    contextWindow: 1_048_576,
    vision: true,
    label: "Muse Spark 1.1",
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.09, outputUsdPerMillionTokens: 0.18 },
    contextWindow: 1_000_000,
    vision: false,
    label: "DeepSeek V4 Flash 0731",
    // Same DeepSeek V4 thinking/non-thinking support as the Pro variant.
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "qwen/qwen3.7-max",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 3.75 },
    contextWindow: 1_000_000,
    vision: false,
    label: "Qwen3.7 Max",
    // Qwen3.5+ ship hybrid thinking enabled by default (Qwen docs).
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "moonshotai/kimi-k2.6",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.66, outputUsdPerMillionTokens: 3.41 },
    contextWindow: 262_144,
    vision: true,
    label: "Kimi K2.6",
    // Same base-vs-"-thinking" split as Kimi K3 above — left unsupported.
    reasoningEffort: undefined,
  },
  {
    id: "moonshotai/kimi-k2.7-code",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.74, outputUsdPerMillionTokens: 3.50 },
    contextWindow: 262_144,
    vision: true,
    label: "Kimi K2.7 Code",
    // Coding-specialized variant, not reasoning-branded — left unsupported.
    reasoningEffort: undefined,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.435, outputUsdPerMillionTokens: 0.87 },
    contextWindow: 1_048_576,
    vision: false,
    label: "DeepSeek V4 Pro",
    // DeepSeek V4 confirmed to support thinking and non-thinking modes (DeepSeek API docs).
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },
  {
    id: "qwen/qwen3.7-plus",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0.32, outputUsdPerMillionTokens: 1.28 },
    contextWindow: 1_000_000,
    vision: true,
    label: "Qwen3.7 Plus",
    // Same Qwen3.5+ hybrid thinking support as Qwen3.7 Max.
    reasoningEffort: STANDARD_EFFORT_LEVELS,
  },

  // ── OpenRouter free (require OPENROUTER_API_KEY, $0 per token) ────────────
  {
    id: "inclusionai/ling-3.0-flash:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 262_144,
    vision: false,
    label: "Ling-3.0-flash (free)",
    reasoningEffort: undefined,
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 1_000_000,
    vision: false,
    label: "Nemotron 3 Ultra (free)",
    reasoningEffort: undefined,
  },
  {
    id: "poolside/laguna-s-2.1:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 262_144,
    vision: false,
    label: "Laguna S 2.1 (free)",
    // No identifiable real-world model to confirm reasoning support against.
    reasoningEffort: undefined,
  },
  {
    id: "cohere/north-mini-code:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 256_000,
    vision: false,
    label: "North Mini Code (free)",
    // Cohere's public model line has no known reasoning/thinking mode.
    reasoningEffort: undefined,
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    contextWindow: 262_144,
    vision: true,
    label: "Gemma 4 31B (free)",
    // Gemma (unlike Gemini) has no thinking/reasoning mode historically.
    reasoningEffort: undefined,
  }
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(
  modelId: string,
  modelsList: readonly SupportedChatModelDefinition[] = SUPPORTED_CHAT_MODELS,
) {
  return modelsList.find((model) => model.id === modelId);
}

export function isCustomOrOllamaModelId(modelId: string): boolean {
  return modelId.startsWith("ollama/") || modelId.startsWith("custom/");
}

/**
 * Stricter than `isSupportedChatModel` (server `lib/models.ts`), which accepts any
 * `custom/` or `ollama/` prefixed string on faith and then throws inside the request
 * when resolution fails. Used to validate hand-authored model ids (agent files) at
 * load time instead, where the failure can degrade to a warning.
 *
 * `ollama/` is still accepted optimistically: verifying it needs a live call to the
 * Ollama daemon, which can't happen during a synchronous load, so an unreachable or
 * deleted Ollama model still surfaces at request time exactly as it does today.
 */
export function isResolvableModelId(
  modelId: string,
  customModelIds: readonly string[] = [],
  modelsList: readonly SupportedChatModelDefinition[] = SUPPORTED_CHAT_MODELS,
): boolean {
  if (findSupportedChatModel(modelId, modelsList)) return true;
  if (modelId.startsWith("ollama/")) return true;
  if (modelId.startsWith("custom/")) return customModelIds.includes(modelId);
  return false;
}

/** Returns the context window size in tokens for a given model ID. Falls back to 128k for unknown/local models. */
export function getContextWindow(
  modelId: string,
  modelsList: readonly SupportedChatModelDefinition[] = SUPPORTED_CHAT_MODELS,
): number {
  const model = findSupportedChatModel(modelId, modelsList);
  return model?.contextWindow ?? 128_000;
}

/** Returns true if the model supports image inputs (vision). Falls back to false for unknown/local models. */
export function isVisionModel(
  modelId: string,
  modelsList: readonly SupportedChatModelDefinition[] = SUPPORTED_CHAT_MODELS,
): boolean {
  const model = findSupportedChatModel(modelId, modelsList);
  return model?.vision ?? false;
}

/** Returns the reasoning effort levels a model accepts, or null if it doesn't support the setting. */
export function getReasoningEffortLevels(
  modelId: string,
  modelsList: readonly SupportedChatModelDefinition[] = SUPPORTED_CHAT_MODELS,
): readonly ReasoningEffortLevel[] | null {
  return findSupportedChatModel(modelId, modelsList)?.reasoningEffort ?? null;
}

/**
 * Enriches a KOINCODE supported model definition with dynamic pricing, context window,
 * vision capabilities, and reasoning effort levels fetched from models.dev/api.json.
 */
export function enrichModelWithModelsDevData(
  model: SupportedChatModelDefinition,
  apiData: ModelsDevApiResponse | null,
): SupportedChatModelDefinition {
  if (!apiData) return model;

  let devModel: ModelsDevModelEntry | undefined;
  const providerGroup = apiData[model.provider];
  if (providerGroup?.models) {
    devModel = providerGroup.models[model.id];
  }

  if (!devModel) {
    for (const pKey of Object.keys(apiData)) {
      const pEntry = apiData[pKey];
      if (pEntry?.models) {
        if (pEntry.models[model.id]) {
          devModel = pEntry.models[model.id];
          break;
        }
        for (const mKey of Object.keys(pEntry.models)) {
          const m = pEntry.models[mKey];
          if (m?.id === model.id) {
            devModel = m;
            break;
          }
        }
        if (devModel) break;
      }
    }
  }

  if (!devModel) return model;

  const pricing: ModelPricing = {
    inputUsdPerMillionTokens: devModel.cost?.input ?? model.pricing.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: devModel.cost?.output ?? model.pricing.outputUsdPerMillionTokens,
    ...(devModel.cost?.cache_read !== undefined ? { cacheReadUsdPerMillionTokens: devModel.cost.cache_read } : {}),
    ...(devModel.cost?.cache_write !== undefined ? { cacheWriteUsdPerMillionTokens: devModel.cost.cache_write } : {}),
  };

  const contextWindow = devModel.limit?.context ?? model.contextWindow;

  // The only thing that makes a model vision-capable is accepting image inputs. models.dev's
  // `attachment` flag (file uploads incl. PDFs) does NOT count: PDFs and other files are read
  // and transcoded locally in the CLI's read-file tool, so an "attachment: true" model with no
  // image modality is not vision-capable for our purposes. When models.dev is silent about
  // input modalities, the static value stands.
  const hasImageModality = Array.isArray(devModel.modalities?.input)
    ? devModel.modalities.input.includes("image")
    : undefined;
  const vision = hasImageModality ?? model.vision;

  let reasoningEffort: readonly ReasoningEffortLevel[] | undefined = model.reasoningEffort;
  const effortOption = devModel.reasoning_options?.find(
    (opt) => opt.type === "effort" && Array.isArray(opt.values),
  );
  if (effortOption?.values) {
    const valid = effortOption.values.filter((v): v is ReasoningEffortLevel =>
      (REASONING_EFFORT_LEVELS as readonly string[]).includes(v),
    );
    // No overlap with our level set means models.dev is describing a vocabulary we don't
    // speak (provider-specific tiers), not "this model has no effort dial" — keep the
    // hand-verified static array rather than silently removing the /effort control.
    if (valid.length > 0) reasoningEffort = valid;
  } else if (devModel.reasoning === false) {
    reasoningEffort = undefined;
  }

  return {
    ...model,
    pricing,
    contextWindow,
    vision,
    reasoningEffort,
  };
}

export type OllamaModelsResponse = {
  ollama: Array<{ id: string; name: string; size?: number }> | null;
};

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "claude-sonnet-5";

export const FALLBACK_MODEL_ID: SupportedChatModelId = "inclusionai/ling-3.0-flash:free";

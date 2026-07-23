import fs from "fs";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from "ai";

import {
  findSupportedChatModel,
  isCustomOrOllamaModelId,
  getReasoningEffortLevels,
  GLOBAL_CONFIG_FILE,
  type KoincodeGlobalConfig,
  type CustomModelConfig,
  type CustomProviderConfig,
  type ReasoningEffortLevel,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@koincode/shared";
import { resolveOllamaBaseURL } from "./ollama";

type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai"    }>["id"];
type GoogleModelId = Extract<SupportedChatModel, { provider: "google"    }>["id"];
type XaiModelId = Extract<SupportedChatModel, { provider: "xai"       }>["id"];

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: string;
  providerOptions?: ProviderOptions;
  /** Known only for models outside the curated list (Ollama's real num_ctx, a custom model's configured value). */
  contextWindow?: number;
  /**
   * True only when talking directly to Anthropic's API with a real Anthropic key.
   * Explicitly false (not just unset) on the OpenRouter fallback path — whether
   * cache_control passes through OpenRouter's routing is unverified, so callers
   * must not assume `provider === "anthropic"` alone means caching is safe to use.
   */
  promptCaching?: boolean;
};

// Thinking is a provider-level capability — enabled for every model from providers that support it.
// These are the fallback used when the user hasn't chosen a reasoning effort yet (or the model
// doesn't support the setting) — a model that can reason should never end up with *less* of it
// just because the new effort control was never touched.
const ANTHROPIC_THINKING: ProviderOptions = {
  anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
};

const GOOGLE_THINKING: ProviderOptions = {
  google: { thinkingConfig: { thinkingBudget: 10000 } },
};

// OpenAI: gpt-4o/mini have no thinking mode; o-series models reason by default — no options needed.

// ─── Reasoning effort: translating the UI's low/medium/high into each provider's own
// mechanism. See context/feature-specs/44-reasoning-effort-model-label.md for the research
// behind each of these.

// Confirmed per Anthropic's platform docs: manual budgetTokens is a hard 400 error on
// claude-fable-5/claude-opus-4-8/claude-opus-4-7/claude-sonnet-5 — adaptive is the only way to
// get reasoning depth control on those. budgetTokens still works on claude-sonnet-4-6 but is
// deprecated there; adaptive is recommended. claude-haiku-4-5 never got the adaptive upgrade —
// budgetTokens is its only mechanism, and thinking is off by default unless it's set explicitly.

// claude-haiku-4-5 only ever exposes the standard low/medium/high levels (see models.ts's
// registry entry) — Partial since the wider ReasoningEffortLevel union now includes
// minimal/xhigh/max, which this model's own declared level list never actually offers.
const HAIKU_BUDGET_BY_EFFORT: Partial<Record<ReasoningEffortLevel, number>> = {
  low: 4000,
  medium: 10000, // matches ANTHROPIC_THINKING's existing default
  high: 24000,
};

function anthropicEffortOptions(
  modelId: AnthropicModelId,
  effort: ReasoningEffortLevel,
): ProviderOptions {
  if (modelId === "claude-haiku-4-5") {
    return {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: HAIKU_BUDGET_BY_EFFORT[effort] ?? 10000 },
      },
    };
  }
  // Adaptive-only and dual-support (claude-sonnet-4-6) models both take the adaptive path —
  // it's recommended even where the old budget path still works.
  return { anthropic: { thinking: { type: "adaptive" }, effort } };
}

// Confirmed against ai.google.dev/gemini-api/docs/thinking's documented min/max/default per
// model. Gemini 2.5 entries only ever expose the standard low/medium/high levels — inner
// Partial since the wider ReasoningEffortLevel union now includes minimal/xhigh/max.
const GEMINI_25_BUDGET_BY_EFFORT: Partial<Record<GoogleModelId, Partial<Record<ReasoningEffortLevel, number>>>> = {
  "gemini-2.5-pro": { low: 3000, medium: 9000, high: 28000 }, // range 128–32,768, no full disable
  "gemini-2.5-flash": { low: 500, medium: 9000, high: 22000 }, // range 0–24,576, 0 disables entirely
};

function googleEffortOptions(modelId: GoogleModelId, effort: ReasoningEffortLevel): ProviderOptions {
  const isGemini3Line = modelId.startsWith("gemini-3"); // Gemini 3 and 3.1 use thinkingLevel
  if (isGemini3Line) {
    return { google: { thinkingConfig: { thinkingLevel: effort, includeThoughts: true } } };
  }
  
  const budget = GEMINI_25_BUDGET_BY_EFFORT[modelId]?.[effort] ?? 10000; // matches GOOGLE_THINKING's default
  return { google: { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } } };
}

function xaiEffortOptions(effort: ReasoningEffortLevel): ProviderOptions {
  return { xai: { reasoningEffort: effort } };
}

function openaiEffortOptions(effort: ReasoningEffortLevel): ProviderOptions {
  return { openai: { reasoningEffort: effort } };
}

function openrouterEffortOptions(effort: ReasoningEffortLevel): ProviderOptions {
  return { openrouter: { reasoning: { effort } } };
}

function assertUnsupportedProvider(provider: never): never {
  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Ollama/custom models (DeepSeek R1, QwQ, some Kimi/GLM variants) often emit
 * `<think>...</think>` inline in plain text rather than a structured reasoning
 * field. Extract it into a proper reasoning part so it renders in the existing
 * collapsible "Thinking..." UI instead of showing up as literal tags in the answer.
 */
function withReasoningExtraction(model: LanguageModelV3): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}

function readConfigKey(
  key: keyof NonNullable<KoincodeGlobalConfig["apiKeys"]>,
): string | undefined {
  try {
    const config = JSON.parse(
      fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"),
    ) as KoincodeGlobalConfig;
    return config.apiKeys?.[key] || undefined;
  } catch {
    return undefined;
  }
}

function requireOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY ?? readConfigKey("openrouter");
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Run `koincode --openrouter-key <key>` or use /setup.",
    );
  }
  return key;
}

/** True only when `effort` was given and this model's registry entry actually lists it as supported. */
function supportsEffort(modelId: string, effort: ReasoningEffortLevel | undefined): effort is ReasoningEffortLevel {
  return effort != null && (getReasoningEffortLevels(modelId)?.includes(effort) ?? false);
}

function resolveViaOpenRouter(
  modelId: string,
  provider: SupportedProvider,
  effort?: ReasoningEffortLevel,
): ResolvedModel {
  const openrouter = createOpenRouter({ apiKey: requireOpenRouterKey() });
  // openrouter-native models already carry their full provider/name ID.
  // anthropic/openai/google/xai models get the provider prefix prepended.
  // xAI's OpenRouter slug is "x-ai", not "xai" — everyone else matches our provider name.
  const openRouterProviderSlug = provider === "xai" ? "x-ai" : provider;
  const routerModelId = provider === "openrouter" ? modelId : `${openRouterProviderSlug}/${modelId}`;
  // OpenRouter's automatic prompt caching (top-level `cache_control`, auto-advancing
  // breakpoint) only applies to Anthropic models — confirmed against OpenRouter's docs
  // and this package's own types. OpenAI models cache automatically on OpenRouter with
  // no config needed, same as calling OpenAI directly, so nothing to set for them here.
  const settings = provider === "anthropic" ? { cache_control: { type: "ephemeral" as const } } : undefined;
  return {
    model: openrouter.chat(routerModelId, settings),
    provider,
    modelId: modelId as SupportedChatModelId,
    // OpenRouter normalizes reasoning effort itself, regardless of underlying provider — this
    // also closes the previous gap where Anthropic/Google's thinking silently disappeared here.
    providerOptions: supportsEffort(modelId, effort) ? openrouterEffortOptions(effort) : undefined,
  };
}

function resolveAnthropicModel(modelId: AnthropicModelId, effort?: ReasoningEffortLevel): ResolvedModel {
  if (!process.env.ANTHROPIC_API_KEY) {
    const key = readConfigKey("anthropic");
    if (key) process.env.ANTHROPIC_API_KEY = key;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      model: anthropic(modelId),
      provider: "anthropic",
      modelId,
      providerOptions: supportsEffort(modelId, effort)
        ? anthropicEffortOptions(modelId, effort)
        : ANTHROPIC_THINKING,
      promptCaching: true,
    };
  }
  return resolveViaOpenRouter(modelId, "anthropic", effort);
}

function resolveOpenAIModel(modelId: OpenAIModelId, effort?: ReasoningEffortLevel): ResolvedModel {
  if (!process.env.OPENAI_API_KEY) {
    const key = readConfigKey("openai");
    if (key) process.env.OPENAI_API_KEY = key;
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      model: openai(modelId),
      provider: "openai",
      modelId,
      providerOptions: supportsEffort(modelId, effort) ? openaiEffortOptions(effort) : undefined,
    };
  }
  return resolveViaOpenRouter(modelId, "openai", effort);
}

function resolveGoogleModel(modelId: GoogleModelId, effort?: ReasoningEffortLevel): ResolvedModel {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const key = readConfigKey("google");
    if (key) process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      model: google(modelId),
      provider: "google",
      modelId,
      providerOptions: supportsEffort(modelId, effort)
        ? googleEffortOptions(modelId, effort)
        : GOOGLE_THINKING,
    };
  }
  return resolveViaOpenRouter(modelId, "google", effort);
}

function resolveXaiModel(modelId: XaiModelId, effort?: ReasoningEffortLevel): ResolvedModel {
  if (!process.env.XAI_API_KEY) {
    const key = readConfigKey("xai");
    if (key) process.env.XAI_API_KEY = key;
  }
  if (process.env.XAI_API_KEY) {
    return {
      model: xai(modelId),
      provider: "xai",
      modelId,
      providerOptions: supportsEffort(modelId, effort) ? xaiEffortOptions(effort) : undefined,
    };
  }
  return resolveViaOpenRouter(modelId, "xai", effort);
}

function resolveSupportedChatModel(model: SupportedChatModel, effort?: ReasoningEffortLevel): ResolvedModel {
  const provider = model.provider;
  switch (provider) {
    case "anthropic":
      return resolveAnthropicModel(model.id, effort);
    case "openai":
      return resolveOpenAIModel(model.id, effort);
    case "google":
      return resolveGoogleModel(model.id, effort);
    case "xai":
      return resolveXaiModel(model.id, effort);
    case "openrouter":
      return resolveViaOpenRouter(model.id, "openrouter", effort);
    default:
      return assertUnsupportedProvider(provider);
  }
}

export function isSupportedChatModel(modelId: string): boolean {
  return findSupportedChatModel(modelId) != null || isCustomOrOllamaModelId(modelId);
}

function readGlobalConfig(): KoincodeGlobalConfig {
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8")) as KoincodeGlobalConfig;
  } catch {
    return {};
  }
}

function readCustomModels(): CustomModelConfig[] {
  return readGlobalConfig().customModels ?? [];
}

function readCustomProviders(): CustomProviderConfig[] {
  return readGlobalConfig().customProviders ?? [];
}

type OllamaShowResponse = {
  model_info?: Record<string, unknown>;
};

/**
 * Ollama namespaces context length under the model's architecture, e.g.
 * "llama.context_length" or "qwen2.context_length" — there's no fixed key name,
 * so scan for the first one that matches.
 */
async function fetchOllamaContextLength(
  baseURL: string,
  modelName: string,
): Promise<number | undefined> {
  try {
    const response = await fetch(`${baseURL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as OllamaShowResponse;
    for (const [key, value] of Object.entries(data.model_info ?? {})) {
      if (key.endsWith(".context_length") && typeof value === "number") return value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveOllamaModel(modelId: string): Promise<ResolvedModel> {
  const ollamaModelName = modelId.slice("ollama/".length);
  const rootBaseURL = resolveOllamaBaseURL();
  const provider = createOllama({ name: "ollama", baseURL: `${rootBaseURL}/api` });
  const contextLength = await fetchOllamaContextLength(rootBaseURL, ollamaModelName);
  return {
    model: withReasoningExtraction(provider.chat(ollamaModelName)),
    provider: "ollama",
    modelId,
    providerOptions: contextLength
      ? { ollama: { options: { num_ctx: contextLength } } }
      : undefined,
    contextWindow: contextLength,
  };
}

function resolveCustomModel(modelId: string): ResolvedModel {
  const model = readCustomModels().find((m) => m.id === modelId);

  if (!model) throw new Error(`Custom model not configured: ${modelId}`);

  const provider = readCustomProviders().find((p) => p.id === model.providerId);
  
  if (!provider) throw new Error(`Custom provider not configured for model: ${modelId}`);
  
  const client = createOpenAICompatible({
    name: "custom",
    baseURL: provider.baseURL,
    apiKey: provider.apiKey ?? "custom",
    includeUsage: true,
  });

  return {
    model: withReasoningExtraction(client(model.modelId)),
    provider: "custom",
    modelId,
    contextWindow: model.contextWindow,
  };
}

export async function resolveChatModel(
  modelId: string,
  effort?: ReasoningEffortLevel,
): Promise<ResolvedModel> {
  if (modelId.startsWith("ollama/")) return resolveOllamaModel(modelId);
  if (modelId.startsWith("custom/")) return resolveCustomModel(modelId);
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`Unsupported model: ${modelId}`);
  return resolveSupportedChatModel(model, effort);
}

import fs from "fs";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from "ai";

import {
  findSupportedChatModel,
  isCustomOrOllamaModelId,
  GLOBAL_CONFIG_FILE,
  type KoincodeGlobalConfig,
  type CustomModelConfig,
  type CustomProviderConfig,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@koincode/shared";
import { resolveOllamaBaseURL } from "./ollama";

type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai"    }>["id"];
type GoogleModelId = Extract<SupportedChatModel, { provider: "google"    }>["id"];

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
const ANTHROPIC_THINKING: ProviderOptions = {
  anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
};

const GOOGLE_THINKING: ProviderOptions = {
  google: { thinkingConfig: { thinkingBudget: 10000 } },
};

// OpenAI: gpt-4o/mini have no thinking mode; o-series models reason by default — no options needed.

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

function resolveViaOpenRouter(
  modelId: string,
  provider: SupportedProvider,
): ResolvedModel {
  const openrouter = createOpenRouter({ apiKey: requireOpenRouterKey() });
  // openrouter-native models already carry their full provider/name ID.
  // anthropic/openai/google models get the provider prefix prepended.
  const routerModelId = provider === "openrouter" ? modelId : `${provider}/${modelId}`;
  // OpenRouter's automatic prompt caching (top-level `cache_control`, auto-advancing
  // breakpoint) only applies to Anthropic models — confirmed against OpenRouter's docs
  // and this package's own types. OpenAI models cache automatically on OpenRouter with
  // no config needed, same as calling OpenAI directly, so nothing to set for them here.
  const settings = provider === "anthropic" ? { cache_control: { type: "ephemeral" as const } } : undefined;
  return {
    model: openrouter.chat(routerModelId, settings),
    provider,
    modelId: modelId as SupportedChatModelId,
  };
}

function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
  if (!process.env.ANTHROPIC_API_KEY) {
    const key = readConfigKey("anthropic");
    if (key) process.env.ANTHROPIC_API_KEY = key;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      model: anthropic(modelId),
      provider: "anthropic",
      modelId,
      providerOptions: ANTHROPIC_THINKING,
      promptCaching: true,
    };
  }
  return resolveViaOpenRouter(modelId, "anthropic");
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
  if (!process.env.OPENAI_API_KEY) {
    const key = readConfigKey("openai");
    if (key) process.env.OPENAI_API_KEY = key;
  }
  if (process.env.OPENAI_API_KEY) {
    return { model: openai(modelId), provider: "openai", modelId };
  }
  return resolveViaOpenRouter(modelId, "openai");
}

function resolveGoogleModel(modelId: GoogleModelId): ResolvedModel {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const key = readConfigKey("gemini");
    if (key) process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      model: google(modelId),
      provider: "google",
      modelId,
      providerOptions: GOOGLE_THINKING,
    };
  }
  return resolveViaOpenRouter(modelId, "google");
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
  const provider = model.provider;
  switch (provider) {
    case "anthropic":
      return resolveAnthropicModel(model.id);
    case "openai":
      return resolveOpenAIModel(model.id);
    case "google":
      return resolveGoogleModel(model.id);
    case "openrouter":
      return resolveViaOpenRouter(model.id, "openrouter");
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

export async function resolveChatModel(modelId: string): Promise<ResolvedModel> {
  if (modelId.startsWith("ollama/")) return resolveOllamaModel(modelId);
  if (modelId.startsWith("custom/")) return resolveCustomModel(modelId);
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`Unsupported model: ${modelId}`);
  return resolveSupportedChatModel(model);
}

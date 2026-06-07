import fs from "fs";
import { anthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

import {
  findSupportedChatModel,
  isLocalModelId,
  GLOBAL_CONFIG_FILE,
  type KoincodeGlobalConfig,
  type LocalModelConfig,
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
  return {
    model: openrouter.chat(routerModelId),
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
  return findSupportedChatModel(modelId) != null || isLocalModelId(modelId);
}

function readLocalModels(): LocalModelConfig[] {
  try {
    const config = JSON.parse(
      fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"),
    ) as KoincodeGlobalConfig;
    return config.localModels ?? [];
  } catch {
    return [];
  }
}

function resolveLocalModel(modelId: string): ResolvedModel {
  if (modelId.startsWith("ollama/")) {
    const ollamaModelName = modelId.slice("ollama/".length);
    const baseURL = `${resolveOllamaBaseURL()}/v1`;
    const provider = createOpenAI({ baseURL, apiKey: "ollama" });
    return { model: provider(ollamaModelName), provider: "ollama", modelId };
  }

  if (modelId.startsWith("local/")) {
    const localModelName = modelId.slice("local/".length);
    const entry = readLocalModels().find((m) => m.id === modelId);
    if (!entry) throw new Error(`Local model not configured: ${modelId}`);
    const provider = createOpenAI({ baseURL: entry.baseURL, apiKey: "local" });
    return { model: provider(localModelName), provider: "local", modelId };
  }

  throw new Error(`Unknown local model format: ${modelId}`);
}

export function resolveChatModel(modelId: string): ResolvedModel {
  if (isLocalModelId(modelId)) return resolveLocalModel(modelId);
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`Unsupported model: ${modelId}`);
  return resolveSupportedChatModel(model);
}

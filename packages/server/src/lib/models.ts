import fs from "fs";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

import {
  findSupportedChatModel,
  GLOBAL_CONFIG_FILE,
  type KoincodeGlobalConfig,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@koincode/shared";

type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai"    }>["id"];
type GoogleModelId = Extract<SupportedChatModel, { provider: "google"    }>["id"];

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelId;
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

export function isSupportedChatModel(
  modelId: string,
): modelId is SupportedChatModelId {
  return findSupportedChatModel(modelId) != null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`Unsupported model: ${modelId}`);
  return resolveSupportedChatModel(model);
}

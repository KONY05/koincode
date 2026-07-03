import type {
  CustomModelConfig,
  CustomModelInput,
  CustomProviderConfig,
  CustomProviderInput,
} from "@koincode/shared";
import { readGlobalConfig, updateGlobalConfig } from "../utils/configs/global-config";

function generateId(prefix: "provider" | "custom"): string {
  return `${prefix}/${crypto.randomUUID().slice(0, 8)}`;
}

export function listCustomProviders(): CustomProviderConfig[] {
  return readGlobalConfig().customProviders ?? [];
}

export function listCustomModels(): CustomModelConfig[] {
  return readGlobalConfig().customModels ?? [];
}

export function customModelsForProvider(providerId: string): CustomModelConfig[] {
  return listCustomModels().filter((m) => m.providerId === providerId);
}

/**
 * Resolves a model id to what the user should actually see. Custom-model ids are opaque
 * (e.g. "custom/1a2b3c") — swap in the literal `modelId` string for display. Everything
 * else (built-in ids, "ollama/<name>") is already human-readable, so it passes through.
 */
export function getModelDisplayName(modelId: string): string {
  if (!modelId.startsWith("custom/")) return modelId;
  const entry = listCustomModels().find((m) => m.id === modelId);
  return entry?.modelId ?? modelId;
}

/** For a custom model id, resolves the name of the provider it belongs to (e.g. "Groq"). */
export function getCustomProviderName(modelId: string): string | undefined {
  if (!modelId.startsWith("custom/")) return undefined;
  const model = listCustomModels().find((m) => m.id === modelId);
  if (!model) return undefined;
  return listCustomProviders().find((p) => p.id === model.providerId)?.name;
}

/** Creates a provider and its first model together so a provider is never left with zero models. */
export function addCustomProviderWithModel(
  providerInput: CustomProviderInput,
  modelInput: CustomModelInput,
): { provider: CustomProviderConfig; model: CustomModelConfig } {
  const provider: CustomProviderConfig = {
    id: generateId("provider"),
    name: providerInput.name,
    baseURL: providerInput.baseURL,
    apiKey: providerInput.apiKey || undefined,
  };
  const model: CustomModelConfig = {
    id: generateId("custom"),
    providerId: provider.id,
    modelId: modelInput.modelId,
    contextWindow: modelInput.contextWindow,
    vision: modelInput.vision,
  };
  updateGlobalConfig({
    customProviders: [...listCustomProviders(), provider],
    customModels: [...listCustomModels(), model],
  });
  return { provider, model };
}

export function addCustomModel(
  providerId: string,
  modelInput: CustomModelInput,
): CustomModelConfig {
  const model: CustomModelConfig = {
    id: generateId("custom"),
    providerId,
    modelId: modelInput.modelId,
    contextWindow: modelInput.contextWindow,
    vision: modelInput.vision,
  };
  updateGlobalConfig({ customModels: [...listCustomModels(), model] });
  return model;
}

export function updateCustomProvider(providerId: string, input: CustomProviderInput): void {
  const providers = listCustomProviders().map((p) =>
    p.id === providerId
      ? { ...p, name: input.name, baseURL: input.baseURL, apiKey: input.apiKey || undefined }
      : p,
  );
  updateGlobalConfig({ customProviders: providers });
}

export function deleteCustomModel(modelId: string): void {
  updateGlobalConfig({ customModels: listCustomModels().filter((m) => m.id !== modelId) });
}

/** Cascades: removes the provider and every model that references it. */
export function deleteCustomProvider(providerId: string): { deletedModelCount: number } {
  const remainingModels = listCustomModels().filter((m) => m.providerId !== providerId);

  const deletedModelCount = listCustomModels().length - remainingModels.length;

  updateGlobalConfig({
    customProviders: listCustomProviders().filter((p) => p.id !== providerId),
    customModels: remainingModels,
  });
  
  return { deletedModelCount };
}

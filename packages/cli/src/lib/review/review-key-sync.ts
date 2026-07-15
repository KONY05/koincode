import { findSupportedChatModel } from "@koincode/shared";
import { readGlobalConfig } from "../../utils/configs/global-config";

type SyncableProvider = "anthropic" | "openai" | "google" | "openrouter";

export type SyncableKey =
  | { ok: true; provider: SyncableProvider; apiKey: string; model: string }
  | { ok: false; reason: "unsupported-model" | "no-key-for-provider" };

const SYNCABLE_PROVIDERS: readonly SyncableProvider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
];

function isSyncableProvider(
  provider: string,
): provider is SyncableProvider {
  return (SYNCABLE_PROVIDERS as readonly string[]).includes(provider);
}

export function resolveSyncableKey(modelId: string): SyncableKey {
  const model = findSupportedChatModel(modelId);
  if (!model || !isSyncableProvider(model.provider)) {
    return { ok: false, reason: "unsupported-model" };
  }

  const keys = readGlobalConfig().apiKeys ?? {};
  const apiKey = keys[model.provider];

  if (!apiKey) {
    return { ok: false, reason: "no-key-for-provider" };
  }

  return { ok: true, provider: model.provider, apiKey, model: model.id };
}

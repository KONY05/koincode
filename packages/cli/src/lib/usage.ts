import { execSync } from "node:child_process";

import { findSupportedChatModel } from "@koincode/shared";
import { readGlobalConfig } from "../utils/configs/global-config";

const USAGE_URLS = {
  anthropic: "https://console.anthropic.com/settings/usage",
  openai: "https://platform.openai.com/usage",
  google: "https://aistudio.google.com/apikey",
  xai: "https://console.x.ai/",
  openrouter: "https://openrouter.ai/activity",
} as const;

export type UsageTarget =
  | { type: "url";
      url: string;
      via: "direct" | "openrouter" }
  | { type: "ollama" }
  | { type: "custom" }
  | { type: "no-keys" };

export function resolveUsageTarget(modelId: string): UsageTarget {
  if (modelId.startsWith("ollama/")) return { type: "ollama" };
  if (modelId.startsWith("custom/")) return { type: "custom" };

  const model = findSupportedChatModel(modelId);
  if (!model) return { type: "no-keys" };

  const keys = readGlobalConfig().apiKeys ?? {};

  const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY || keys.anthropic);
  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY || keys.openai);
  const hasGoogleKey = !!(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || keys.gemini
  );
  const hasXaiKey = !!(process.env.XAI_API_KEY || keys.xai);
  const hasOpenRouterKey = !!(
    process.env.OPENROUTER_API_KEY || keys.openrouter
  );

  // Native OpenRouter models always use the OpenRouter dashboard
  if (model.provider === "openrouter") {
    return hasOpenRouterKey
      ? { type: "url", url: USAGE_URLS.openrouter, via: "direct" }
      : { type: "no-keys" };
  }

  // For anthropic/openai/google/xai: prefer the direct key, fall back to OpenRouter
  const [hasDirectKey, directUrl] = (() => {
    switch (model.provider) {
      case "anthropic":
        return [hasAnthropicKey, USAGE_URLS.anthropic] as const;
      case "openai":
        return [hasOpenAIKey, USAGE_URLS.openai] as const;
      case "google":
        return [hasGoogleKey, USAGE_URLS.google] as const;
      case "xai":
        return [hasXaiKey, USAGE_URLS.xai] as const;
      default:
        return [false, ""] as const;
    }
  })();

  if (hasDirectKey) return { type: "url", url: directUrl, via: "direct" };
  if (hasOpenRouterKey)
    return { type: "url", url: USAGE_URLS.openrouter, via: "openrouter" };
  return { type: "no-keys" };
}

export function hasApiKeyForModel(modelId: string): boolean {
  return resolveUsageTarget(modelId).type !== "no-keys";
}

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  execSync(cmd);
}

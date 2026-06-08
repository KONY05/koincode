import { generateText } from "ai";

import { BOUNDARY_ROLES, findSupportedChatModel, type SupportedProvider } from "@koincode/shared";
import { resolveChatModel } from "./models";

const PROVIDER_FALLBACKS: Partial<Record<SupportedProvider, string[]>> = {
  anthropic:  ["claude-sonnet-4-6", "claude-haiku-4-5"],
  openai:     ["gpt-4o-mini", "gpt-4.1-nano"],
  google:     ["gemini-2.0-flash", "gemini-2.5-flash"],
  openrouter: ["openrouter/owl-alpha", "google/gemma-4-31b-it:free"],
};

const GENERATE_TEXT_TIMEOUT_MS = 60_000;

/**
 * Runs generateText with the preferred model, falling back through same-provider
 * cheaper models if the preferred model is unavailable or errors.
 * Each attempt is killed after `timeoutMs` (default 60 s) so a hanging network
 * call doesn't block the fallback chain indefinitely.
 * Local/Ollama models get one attempt only (no cross-endpoint fallback possible).
 */
export async function generateTextWithFallback(
  preferredModelId: string,
  options: Omit<Parameters<typeof generateText>[0], "model">,
  timeoutMs = GENERATE_TEXT_TIMEOUT_MS,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  const provider = findSupportedChatModel(preferredModelId)?.provider;
  const fallbacks = provider ? (PROVIDER_FALLBACKS[provider] ?? []) : [];
  const modelsToTry = [preferredModelId, ...fallbacks.filter((m) => m !== preferredModelId)];

  let lastError: unknown;
  for (const modelId of modelsToTry) {
    try {
      const abortSignal = AbortSignal.timeout(timeoutMs);
      return await generateText({
        ...options,
        model: resolveChatModel(modelId).model,
        abortSignal,
      } as Parameters<typeof generateText>[0]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      logger.warn(
        isTimeout
          ? `generateText timed out for model ${modelId} after ${timeoutMs}ms, trying next fallback…`
          : `generateText failed with model ${modelId}, trying next fallback…`,
      );
      lastError = err;
    }
  }
  throw lastError;
}

/** Returns the index of the last clear/compact boundary in a DB message records array, or -1 if none. */
export function getLastBoundaryIndex(records: Array<{ role: string }>): number {
  for (let i = records.length - 1; i >= 0; i--) {
    if (BOUNDARY_ROLES.has(records[i]?.role ?? "")) return i;
  }
  return -1;
}

export function getTime(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const logger = {
  info(...args: unknown[]) {
    console.log(`[${getTime()}]`, ...args);
  },
  error(...args: unknown[]) {
    console.error(`[${getTime()}]`, ...args);
  },
  warn(...args: unknown[]) {
    console.warn(`[${getTime()}]`, ...args);
  },
};
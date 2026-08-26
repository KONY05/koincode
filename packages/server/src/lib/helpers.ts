import { generateText } from "ai";

import { BOUNDARY_ROLES, type ModelPricing, type SupportedProvider } from "@koincode/shared";
import { resolveChatModel } from "./models";
import { findEnrichedSupportedChatModel } from "./models-registry";
import { FALLBACK_MODEL_ID } from "../../../shared/src/models";

const PROVIDER_FALLBACKS: Partial<Record<SupportedProvider, string[]>> = {
  anthropic:  ["claude-sonnet-4-6", "claude-haiku-4-5"],
  openai:     ["gpt-5-mini", "gpt-4.1-mini"],
  google:     ["gemini-3-flash-preview", "gemini-2.5-flash"],
  openrouter: [FALLBACK_MODEL_ID, "poolside/laguna-s-2.1:free"],
};

const GENERATE_TEXT_TIMEOUT_MS = 60_000;

/** Max extra retries per model before advancing to the next fallback model. */
const MAX_RETRIES_PER_MODEL = 2;

/** Base delay for exponential backoff. Doubles per retry: 1s → 2s → 4s (±20% jitter). */
const BASE_DELAY_MS = 1_000;

type GeneratedTextWithFallbackResult = Awaited<ReturnType<typeof generateText>> & {
  /** The concrete model that completed the successful attempt (may be a fallback). */
  resolvedModelId: string;
  /** Price card for the actual provider path used at request time. */
  pricing?: ModelPricing;
};

/**
 * Runs generateText with the preferred model, falling back through same-provider
 * cheaper models if the preferred model is unavailable or errors.
 *
 * Each model is tried up to MAX_RETRIES_PER_MODEL + 1 times with exponential
 * backoff before moving to the next fallback. Transient errors (429, 5xx,
 * timeouts, network errors) trigger a retry; hard errors (401, 403, 400, 404)
 * skip immediately to the next fallback model without delay.
 *
 * Each attempt is killed after `timeoutMs` (default 60 s) so a hanging network
 * call doesn't block the fallback chain indefinitely.
 * Local/Ollama models get one attempt only (no cross-endpoint fallback possible).
 */
export async function generateTextWithFallback(
  preferredModelId: string,
  options: Omit<Parameters<typeof generateText>[0], "model">,
  timeoutMs = GENERATE_TEXT_TIMEOUT_MS,
): Promise<GeneratedTextWithFallbackResult> {
  const provider = findEnrichedSupportedChatModel(preferredModelId)?.provider;
  const fallbacks = provider ? (PROVIDER_FALLBACKS[provider] ?? []) : [];
  const modelsToTry = [preferredModelId, ...fallbacks.filter((m) => m !== preferredModelId)];

  let lastError: unknown;

  for (const modelId of modelsToTry) {
    let retryable = true;

    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      // Wait before every retry (not before the first attempt).
      if (attempt > 0) {
        const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20%
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1) * jitter;
        logger.warn(
          `generateText retry ${attempt}/${MAX_RETRIES_PER_MODEL} for model ${modelId} — waiting ${Math.round(delayMs)}ms…`,
        );
        await sleep(delayMs);
      }

      try {
        const abortSignal = AbortSignal.timeout(timeoutMs);
        const resolved = await resolveChatModel(modelId);
        const result = await generateText({
          ...options,
          model: resolved.model,
          abortSignal,
        } as Parameters<typeof generateText>[0]);

        return {
          ...result,
          resolvedModelId: resolved.modelId,
          ...(resolved.pricing ? { pricing: resolved.pricing } : {}),
        };
      } catch (err) {
        lastError = err;
        retryable = isRetryableError(err);

        if (!retryable) {
          logger.warn(
            `generateText failed with non-retryable error for model ${modelId} — skipping to next fallback…`,
          );
          break; // skip remaining retries; advance to next model immediately
        }

        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        logger.warn(
          isTimeout
            ? `generateText timed out for model ${modelId} after ${timeoutMs}ms (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1})…`
            : `generateText failed with model ${modelId} (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1})…`,
        );
      }
    }

    if (retryable) {
      logger.warn(`generateText exhausted retries for model ${modelId} — trying next fallback…`);
    }
  }

  throw lastError;
}

/** Returns true if the error is transient and worth retrying on the same model. */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true; // unknown shape — optimistically retry

  // TimeoutError from AbortSignal.timeout()
  if (err.name === "TimeoutError") return true;

  // Network-level errors (Node.js / undici surface these in the message)
  const msg = err.message.toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }

  // HTTP status codes surfaced by the AI SDK
  const status = extractHttpStatus(err);
  if (status === null) return true; // no status info — optimistically retry
  if (status === 429) return true;  // rate limited
  if (status >= 500) return true;   // transient server errors (500, 502, 503, 529…)
  // 4xx auth / bad-request errors (400, 401, 403, 404…) are not retryable
  return false;
}

/** Attempts to pull an HTTP status code out of an AI SDK error object. */
function extractHttpStatus(err: Error): number | null {
  // AI SDK wraps HTTP errors with a `statusCode` or `status` field.
  // Cast through `unknown` first so strict TS accepts the index access.
  const e = err as unknown as Record<string, unknown>;
  const cause = err.cause instanceof Error
    ? (err.cause as unknown as Record<string, unknown>)
    : undefined;
  const candidate = e["statusCode"] ?? e["status"] ?? cause?.["status"] ?? cause?.["statusCode"];

  const n = Number(candidate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Simple promise-based delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
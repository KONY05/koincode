import type { ModelMessage, SystemModelMessage, TextPart, Tool } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

const ANTHROPIC_CACHE_CONTROL: ProviderOptions = {
  anthropic: { cacheControl: { type: "ephemeral" } },
};

/** Wraps the (fully stable) system prompt as a single message, optionally marked as a cache breakpoint. */
export function buildCachedSystemMessage(
  systemPrompt: string,
  enableCaching: boolean,
): SystemModelMessage {
  return {
    role: "system",
    content: systemPrompt,
    ...(enableCaching ? { providerOptions: ANTHROPIC_CACHE_CONTROL } : {}),
  };
}

/**
 * Appends per-turn volatile context (the user's active editor file) directly onto
 * the newest message instead of the system prompt. Anthropic's cache_control is a
 * cumulative prefix across `tools → system → messages` (canonical order, confirmed
 * against Anthropic's docs) — any per-turn-varying content placed in `system` would
 * invalidate every later breakpoint's hit, including the messages/history one, even
 * though `system` itself comes before `messages` in that order. Attaching it to the
 * newest message instead costs nothing extra: that message is already a fresh,
 * uncached write every turn, and once finalized it never changes again, so it
 * doesn't threaten future turns' cache hits either.
 *
 * Skipped when the last message is a tool-result continuation (`role: "tool"`) —
 * its content type doesn't allow a plain text part, and there's no fresh user
 * prompt in that request to attach live editor context to anyway.
 */
export function appendIdeContext(
  messages: ModelMessage[],
  ideActiveFile: string | null,
): ModelMessage[] {
  if (!ideActiveFile || messages.length === 0) return messages;

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex]!;
  if (last.role !== "user" && last.role !== "assistant") return messages;

  const contextText =
    `# IDE Context\nThe user currently has **${ideActiveFile}** open in their editor. ` +
    `This is likely the file they want to work on — treat it as the starting point and read it before responding if you haven't already.`;

  const textPart: TextPart = { type: "text", text: contextText };
  const newContent =
    typeof last.content === "string"
      ? `${last.content}\n\n${contextText}`
      : [...last.content, textPart];

  return messages.map((message, i) =>
    i === lastIndex ? ({ ...message, content: newContent } as ModelMessage) : message,
  );
}

/** Marks the last tool definition with a cache breakpoint, so the system prompt + full tool list cache as one prefix. */
export function withToolsCacheControl<T extends Record<string, Tool>>(
  tools: T,
  enableCaching: boolean,
): T {
  if (!enableCaching) return tools;

  const keys = Object.keys(tools);
  const lastKey = keys[keys.length - 1];
  if (!lastKey) return tools;

  return {
    ...tools,
    [lastKey]: { ...tools[lastKey], providerOptions: ANTHROPIC_CACHE_CONTROL },
  };
}

/**
 * Marks the last message with a cache breakpoint so this turn's full history becomes
 * reusable by the next turn — the piece that actually stops cost from compounding as
 * a session grows, rather than just caching the fixed system+tools overhead.
 */
export function withHistoryCacheControl(
  messages: ModelMessage[],
  enableCaching: boolean,
): ModelMessage[] {
  if (!enableCaching || messages.length === 0) return messages;

  const lastIndex = messages.length - 1;
  return messages.map((message, i) =>
    i === lastIndex
      ? { ...message, providerOptions: ANTHROPIC_CACHE_CONTROL }
      : message,
  );
}

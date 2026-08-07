import { type LanguageModelUsage } from "ai";

import type { ReasoningEffortLevel, SupportedChatModelId, ModelPricing } from "./models";
import type { AgentId } from "./agents";

export type ChatMessageMetadata = {
  /** Agent id this turn ran under. Persisted, so it may name an agent that no
   *  longer resolves — `resolveAgent` falls back to BUILD in that case (Decision 10). */
  mode?: AgentId;
  model?: SupportedChatModelId | string;
  reasoningEffort?: ReasoningEffortLevel;
  /** Known only for models outside the curated list (Ollama's real num_ctx, a custom model's configured value). */
  contextWindow?: number;
  /** Pricing at the time of the request for the actual provider path taken (direct or OpenRouter).
   * Includes absolute cache rates from models.dev when available.
   * Persisted so cost calculations use the rate actually charged rather than a registry lookup. */
  pricing?: ModelPricing;
  durationMs?: number;
  usage?: LanguageModelUsage;
  interrupted?: boolean;
  /** Set on synthetic user-role turns delivering a background task's result
   * (spawnAgent runInBackground, scheduleWakeup, backgrounded shell) — the
   * wire-level role stays "user" (required for the model to react to it as a
   * turn), but the CLI renders these on the assistant side instead of as a
   * user-typed bubble. */
  origin?: "background-task";
  /** Structured display data for a "background-task" origin message, set at
   * the point of delivery (spawnAgent's/shell's default listener) — lets the
   * CLI render it as a labeled result card (like a tool call's output) rather
   * than parsing the delivered text back apart. Only set when the delivery
   * has a clean single task to show; scheduleWakeup's fired `prompt` (which
   * may mix free-form text with an appended task result) doesn't set this. */
  backgroundTaskView?: {
    label: string;
    taskId: string;
    status: "completed" | "error";
    output: string;
  };
  /** Ordered stack (oldest first) of this row's own state as it existed
   * immediately before each subsequent merge. `routes/chat.ts` folds consecutive
   * same-role messages together — which happens whenever a user turn is left
   * orphaned by an interrupt/error and the user sends again — so one row can end
   * up covering several attempts. Each entry is a complete snapshot, not a diff:
   * popping the last one and promoting its `id`/`parts` fully reconstructs the
   * pre-merge state, which is what lets `DELETE /:id/messages/last-user` peel off
   * a single attempt instead of wiping the whole chain. `parts` is deliberately
   * opaque here — this data is only stored and replayed, never interpreted, and
   * typing it properly would make this metadata type circular with UIMessage. */
  mergeHistory?: { id: string; parts: unknown[] }[];
};

/** One extra-LLM-call cost record (a model call that produced no normal assistant
 *  message row — e.g. title generation or a sub-agent step). Persisted on the
 *  Session as `auxCost` JSON and folded into the info bar's session cost by the
 *  CLI on top of the message-derived `estimateSessionCost`. */
export type AuxCostEntry = {
  /** What kind of call this was: "title" | "agent-step". */
  kind: string;
  /** Model id that actually produced the tokens (the resolved chat model). */
  model?: string;
  /** Pricing at the time of the request for the provider path actually used. */
  pricing?: ModelPricing;
  usage?: LanguageModelUsage;
};

export const BOUNDARY_ROLES = new Set(["clear_boundary", "compact_boundary"]);

export const IMAGE_PLACEHOLDER_RE = /\[#image:(i\d+)\]/g;
import { type LanguageModelUsage } from "ai";

import type { ReasoningEffortLevel, SupportedChatModelId } from "./models";
import type { ModeType } from "./schemas";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  reasoningEffort?: ReasoningEffortLevel;
  /** Known only for models outside the curated list (Ollama's real num_ctx, a custom model's configured value). */
  contextWindow?: number;
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

export const BOUNDARY_ROLES = new Set(["clear_boundary", "compact_boundary"]);

export const IMAGE_PLACEHOLDER_RE = /\[#image:(i\d+)\]/g;
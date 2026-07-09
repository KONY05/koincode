import { type LanguageModelUsage } from "ai";

import type { SupportedChatModelId } from "./models";
import type { ModeType } from "./schemas";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
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
};

export const BOUNDARY_ROLES = new Set(["clear_boundary", "compact_boundary"]);

export const IMAGE_PLACEHOLDER_RE = /\[#image:(i\d+)\]/g;
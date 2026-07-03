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
};

export const BOUNDARY_ROLES = new Set(["clear_boundary", "compact_boundary"]);

export const IMAGE_PLACEHOLDER_RE = /\[#image:(i\d+)\]/g;
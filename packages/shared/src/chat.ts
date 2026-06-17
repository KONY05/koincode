import { type LanguageModelUsage } from "ai";

import type { SupportedChatModelId } from "./models";
import type { ModeType } from "./schemas";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  durationMs?: number;
  usage?: LanguageModelUsage;
  interrupted?: boolean;
};

export const BOUNDARY_ROLES = new Set(["clear_boundary", "compact_boundary"]);

export const IMAGE_PLACEHOLDER_RE = /\[#image:(i\d+)\]/g;
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
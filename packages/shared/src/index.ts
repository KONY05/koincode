export {
  SUPPORTED_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  type ModelPricing,
  type SupportedProvider,
  type SupportedChatModel,
  type SupportedChatModelId,
} from "./models";

export {
  Mode,
  modeSchema,
  toolInputSchemas,
  getToolContracts,
  readOnlyToolContracts,
  buildToolContracts,
  type ToolContracts,
  type ModeType,
  type TodoItem,
} from "./schemas";

export { type ChatMessageMetadata } from "./chat";

export {
  SERVER_PORT,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_FILE,
  DB_PATH,
  PID_FILE,
} from "./paths";

export type {
  KoincodeGlobalConfig,
  ApiKeys,
  HookEventType,
  HookHandlerType,
  CommandHookHandler,
  // HttpHookHandler,
  // McpToolHookHandler,
  // PromptHookHandler,
  // AgentHookHandler,
  HookHandler,
  HookMatcherGroup,
  HooksConfig,
} from "./config";

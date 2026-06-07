export {
  SUPPORTED_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  isLocalModelId,
  getContextWindow,
  type ModelPricing,
  type SupportedProvider,
  type SupportedChatModel,
  type SupportedChatModelId,
  type LocalModelEntry,
  type LocalModelsResponse,
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

export {
  type ChatMessageMetadata,
  BOUNDARY_ROLES,
} from "./chat";

export {
  SERVER_PORT,
  DEFAULT_OLLAMA_BASE_URL,
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
  LocalModelConfig,
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

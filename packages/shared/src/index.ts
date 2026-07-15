export {
  SUPPORTED_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  isCustomOrOllamaModelId,
  getContextWindow,
  isVisionModel,
  type ModelPricing,
  type SupportedProvider,
  type SupportedChatModel,
  type SupportedChatModelId,
  type OllamaModelsResponse,
} from "./models";

export {
  Mode,
  modeSchema,
  toolInputSchemas,
  getToolContracts,
  readOnlyToolContracts,
  buildToolContracts,
  browserToolContracts,
  buildToolContractsWithBrowser,
  type ToolContracts,
  type ModeType,
  type TodoItem,
} from "./schemas";

export {
  type ChatMessageMetadata,
  BOUNDARY_ROLES,
  IMAGE_PLACEHOLDER_RE,
} from "./chat";

export {
  SERVER_PORT,
  DEFAULT_OLLAMA_BASE_URL,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  IDE_CONTEXT_FILE,
  NOTIFY_REQUEST_FILE,
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_FILE,
  DB_PATH,
  PID_FILE,
  SNAPSHOTS_DIR,
  REVIEW_AUTH_FILE,
} from "./paths";

export { parseMcpToolName, isMcpTool } from "./mcp";

export {
  customProviderInputSchema,
  customModelInputSchema,
  type CustomProviderInput,
  type CustomModelInput,
} from "./config-schemas";

export { SENTRY_DSN } from "./sentry-dsn";

export {
  parseWorkspaceRoots,
  serializeWorkspaceRoots,
  makeRootLabel,
  findRootConflict,
  type WorkspaceRoot,
} from "./workspace";

export type {
  KoincodeGlobalConfig,
  BrowserConfig,
  ApiKeys,
  CustomProviderConfig,
  CustomModelConfig,
  HookEventType,
  HookHandlerType,
  CommandHookHandler,
  McpToolHookHandler,
  // HttpHookHandler,
  // PromptHookHandler,
  // AgentHookHandler,
  HookHandler,
  HookMatcherGroup,
  HooksConfig,
  McpServerConfig,
} from "./config";

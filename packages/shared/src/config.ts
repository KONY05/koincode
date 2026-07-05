import type { ModelPricing } from "./models";

export type McpServerConfig = {
  /** Stdio transport: the executable to run (e.g. "npx"). Mutually exclusive with `url`. */
  command?: string;
  /** Args passed to the stdio command (e.g. ["-y", "@modelcontextprotocol/server-github"]). */
  args?: string[];
  /** Extra environment variables merged with the current process env (e.g. API tokens). */
  env?: Record<string, string>;
  /**
   * Remote transport URL. Defaults to Streamable HTTP (the current MCP standard).
   * Set `transport: "sse"` if the server only supports the legacy SSE protocol.
   * Mutually exclusive with `command`.
   */
  url?: string;
  /**
   * Remote transport protocol. Only relevant when `url` is set.
   * - `"http"` (default) — Streamable HTTP, the current MCP standard.
   * - `"sse"` — Legacy Server-Sent Events transport for older servers.
   */
  transport?: "http" | "sse";
  /** Set to false to skip connecting to this server at startup. Defaults to true. */
  enabled?: boolean;
};

export type ApiKeys = {
  openrouter?: string;
  anthropic?: string;
  openai?: string;
  gemini?: string;
};

export type CustomProviderConfig = {
  /** Opaque, app-generated (e.g. "provider/8f2a1c") — never typed by the user. */
  id: string;
  /** The provider's name, e.g. "OpenRouter", "Groq", "LM Studio" — not a personal nickname. */
  name: string;
  baseURL: string;
  /** Omitted for unauthenticated local servers. */
  apiKey?: string;
};

export type CustomModelConfig = {
  /** Opaque, app-generated (e.g. "custom/1a2b3c") — never typed by the user. */
  id: string;
  /** References CustomProviderConfig.id */
  providerId: string;
  /** Literal model string sent to the provider's API; also what the UI displays. */
  modelId: string;
  contextWindow?: number;
  vision?: boolean;
  pricing?: ModelPricing;
};

// Hook types
export type HookEventType = "PreToolUse" | "PostToolUse" | "PostToolUseFailure";

export type HookHandlerType =
  | "command"
  | "http"
  | "mcp_tool"
  | "prompt"
  | "agent";

export type CommandHookHandler = {
  type: "command";
  command: string;
  args?: string[];
  timeout?: number;
  shell?: "bash" | "powershell";
  async?: boolean;
  if?: string;
};

// export type HttpHookHandler = {
//   type: "http";
//   url: string;
//   method?: "GET" | "POST" | "PUT" | "DELETE";
//   headers?: Record<string, string>;
//   timeout?: number;
//   async?: boolean;
//   if?: string;
// };

export type McpToolHookHandler = {
  type: "mcp_tool";
  /** Namespaced tool name, e.g. "slack__post_message" */
  tool: string;
  args?: Record<string, unknown>;
  timeout?: number;
  async?: boolean;
  if?: string;
};

// export type PromptHookHandler = {
//   type: "prompt";
//   prompt: string;
//   if?: string;
// };

// export type AgentHookHandler = {
//   type: "agent";
//   agent: string;
//   task: string;
//   if?: string;
// };

export type HookHandler = CommandHookHandler | McpToolHookHandler;

export type HookMatcherGroup = {
  matcher: string;
  hooks: HookHandler[];
};

export type HooksConfig = {
  [K in HookEventType]?: HookMatcherGroup[];
};

export type BrowserConfig = {
  enabled?: boolean;
  headless?: boolean;
  ready?: boolean;
  path?: string;
};

// Global Config file type
export type KoincodeGlobalConfig = {
  themeName?: string;
  defaultModel?: string;
  apiKeys?: ApiKeys;
  autoModeSwitch?: "confirm" | "auto";
  hooks?: HooksConfig;
  port?: number;
  ollamaBaseURL?: string;
  customProviders?: CustomProviderConfig[];
  customModels?: CustomModelConfig[];
  voiceInput?: boolean;
  whisperBackend?: "auto" | "openai" | "openrouter";
  infoSidebarVisible?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
  browser?: BrowserConfig;
  telemetry?: boolean;
  notificationEnabled?: boolean;
  analyticsId?: string;
};
export type ApiKeys = {
  openrouter?: string;
  anthropic?: string;
  openai?: string;
  gemini?: string;
};

// Global Config file type
export type KoincodeGlobalConfig = {
  themeName?: string;
  defaultModel?: string;
  apiKeys?: ApiKeys;
  autoModeSwitch?: "confirm" | "auto";
  hooks?: HooksConfig;
  port?: number;
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

// export type McpToolHookHandler = {
//   type: "mcp_tool";
//   tool: string;
//   args?: Record<string, unknown>;
//   timeout?: number;
//   async?: boolean;
//   if?: string;
// };

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

// export type HookHandler =
//   | CommandHookHandler
//   | HttpHookHandler
//   | McpToolHookHandler
//   | PromptHookHandler
//   | AgentHookHandler;

export type HookHandler = CommandHookHandler;

export type HookMatcherGroup = {
  matcher: string;
  hooks: HookHandler[];
};

export type HooksConfig = {
  [K in HookEventType]?: HookMatcherGroup[];
};

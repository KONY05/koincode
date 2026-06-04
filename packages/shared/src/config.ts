export type ApiKeys = {
  openrouter?: string;
  anthropic?: string;
  openai?: string;
  gemini?: string;
};

// Global Config file type
export type KoincodeConfig = {
  themeName?: string;
  defaultModel?: string;
  apiKeys?: ApiKeys;
  autoModeSwitch?: "confirm" | "auto";
  hooks?: HooksConfig;
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

export type HookHandler = CommandHookHandler;

export type HookMatcherGroup = {
  matcher: string;
  hooks: HookHandler[];
};

export type HooksConfig = {
  [K in HookEventType]?: HookMatcherGroup[];
};

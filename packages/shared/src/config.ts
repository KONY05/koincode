export type ApiKeys = {
  openrouter?: string;
  anthropic?: string;
  openai?: string;
  gemini?: string;
};

export type KoincodeConfig = {
  themeName?: string;
  apiKeys?: ApiKeys;
};

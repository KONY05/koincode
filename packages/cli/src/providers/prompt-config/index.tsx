import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_CHAT_MODEL_ID,
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
  isLocalModelId,
  Mode,
  type ModeType,
} from "@koincode/shared";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";
import { trackModelChanged } from "../../lib/analytics";

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
  model: string;
  setModel: (model: string) => void;
  autoModeSwitch: "confirm" | "auto";
  setAutoModeSwitch: (v: "confirm" | "auto") => void;
  voiceInput: boolean;
  toggleVoice: () => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(
  null,
);

type PromptConfigProviderProps = {
  children: ReactNode;
};

function firstModelForProvider(provider: "anthropic" | "openai" | "google"): string {
  return SUPPORTED_CHAT_MODELS.find((m) => m.provider === provider)!.id;
}

function resolveInitialModel(): string {
  const config = readGlobalConfig();

  const saved = config.defaultModel;
  if (saved && (findSupportedChatModel(saved) || isLocalModelId(saved)))
    return saved;

  const keys = config.apiKeys ?? {};
  const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY || keys.anthropic);
  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY || keys.openai);
  const hasGoogleKey = !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || keys.gemini);
  const hasOpenRouterKey = !!(process.env.OPENROUTER_API_KEY || keys.openrouter);

  if (hasAnthropicKey) return firstModelForProvider("anthropic");
  if (hasOpenAIKey) return firstModelForProvider("openai");
  if (hasGoogleKey) return firstModelForProvider("google");
  if (hasOpenRouterKey) return "openrouter/owl-alpha";

  return DEFAULT_CHAT_MODEL_ID;
}

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setMode] = useState<ModeType>(Mode.BUILD);
  const [model, setModelState] = useState<string>(resolveInitialModel);
  const [autoModeSwitch, setAutoModeSwitchState] = useState<"confirm" | "auto">(
    () => readGlobalConfig().autoModeSwitch ?? "confirm",
  );

  const [voiceInput, setVoiceInputState] = useState<boolean>(
    () => readGlobalConfig().voiceInput ?? false,
  );

  const toggleMode = useCallback(() => {
    setMode((m) => (m === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
  }, []);

  const setModel = useCallback((m: string) => {
    setModelState(m);
    updateGlobalConfig({ defaultModel: m });
    trackModelChanged({ model: m });
  }, []);

  const setAutoModeSwitch = useCallback((v: "confirm" | "auto") => {
    setAutoModeSwitchState(v);
    updateGlobalConfig({ autoModeSwitch: v });
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceInputState((v) => {
      const next = !v;
      updateGlobalConfig({ voiceInput: next });
      return next;
    });
  }, []);

  return (
    <PromptConfigContext.Provider
      value={{
        mode,
        toggleMode,
        setMode,
        model,
        setModel,
        autoModeSwitch,
        setAutoModeSwitch,
        voiceInput,
        toggleVoice,
      }}
    >
      {children}
    </PromptConfigContext.Provider>
  );
}

export function usePromptConfig(): PromptConfigContextValue {
  const value = useContext(PromptConfigContext);
  if (!value) {
    throw new Error(
      "usePromptConfig must be used within a PromptConfigProvider",
    );
  }
  return value;
}

import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  isLocalModelId,
  Mode,
  type ModeType,
} from "@koincode/shared";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";

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

function resolveInitialModel(): string {
  const saved = readGlobalConfig().defaultModel;
  if (saved && (findSupportedChatModel(saved) || isLocalModelId(saved)))
    return saved;
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

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_CHAT_MODEL_ID,
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
  isCustomOrOllamaModelId,
  getReasoningEffortLevels,
  Mode,
  type ModeType,
  type ReasoningEffortLevel,
} from "@koincode/shared";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";
import { getModelDisplayName } from "../../lib/custom-models";
import { trackModelChanged } from "../../lib/analytics";
import { FALLBACK_MODEL_ID } from "../../../../shared/src/models";

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
  model: string;
  /** `model` resolved for display — custom-model opaque ids swapped for their real modelId. */
  modelDisplayName: string;
  setModel: (model: string) => void;
  autoModeSwitch: "confirm" | "auto";
  setAutoModeSwitch: (v: "confirm" | "auto") => void;
  /** Clamped to what `model` actually supports — null when the current model has no reasoning effort control. */
  reasoningEffort: ReasoningEffortLevel | null;
  setReasoningEffort: (v: ReasoningEffortLevel) => void;
  voiceInput: boolean;
  toggleVoice: () => void;
  infoSidebarVisible: boolean;
  toggleInfoSidebar: () => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(
  null,
);

type PromptConfigProviderProps = {
  children: ReactNode;
};

function firstModelForProvider(provider: "anthropic" | "openai" | "google" | "xai"): string {
  return SUPPORTED_CHAT_MODELS.find((m) => m.provider === provider)!.id;
}

function resolveInitialModel(): string {
  const config = readGlobalConfig();

  const saved = config.defaultModel;
  if (saved && (findSupportedChatModel(saved) || isCustomOrOllamaModelId(saved)))
    return saved;

  const keys = config.apiKeys ?? {};
  const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY || keys.anthropic);
  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY || keys.openai);
  const hasGoogleKey = !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || keys.google);
  const hasXaiKey = !!(process.env.XAI_API_KEY || keys.xai);
  const hasOpenRouterKey = !!(process.env.OPENROUTER_API_KEY || keys.openrouter);

  if (hasAnthropicKey) return firstModelForProvider("anthropic");
  if (hasOpenAIKey) return firstModelForProvider("openai");
  if (hasGoogleKey) return firstModelForProvider("google");
  if (hasXaiKey) return firstModelForProvider("xai");
  if (hasOpenRouterKey) return FALLBACK_MODEL_ID;

  return DEFAULT_CHAT_MODEL_ID;
}

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setMode] = useState<ModeType>(Mode.BUILD);
  const [model, setModelState] = useState<string>(resolveInitialModel);
  const [autoModeSwitch, setAutoModeSwitchState] = useState<"confirm" | "auto">(
    () => readGlobalConfig().autoModeSwitch ?? "confirm",
  );

  // Raw stored preference, independent of which model is currently selected — the
  // effective `reasoningEffort` below re-derives against the current model's supported
  // levels every time either changes, so switching models never shows a stale value.
  const [reasoningEffortPreference, setReasoningEffortPreferenceState] = useState<
    ReasoningEffortLevel | null
  >(() => readGlobalConfig().reasoningEffort ?? null);

  const [voiceInput, setVoiceInputState] = useState<boolean>(
    () => readGlobalConfig().voiceInput ?? false,
  );

  const [infoSidebarVisible, setInfoSidebarVisible] = useState<boolean>(
    () => process.argv.includes("--info") || (readGlobalConfig().infoSidebarVisible ?? false),
  );

  const modelDisplayName = useMemo(() => getModelDisplayName(model), [model]);

  const reasoningEffort = useMemo<ReasoningEffortLevel | null>(() => {
    const levels = getReasoningEffortLevels(model);
    if (!levels) return null;
    if (reasoningEffortPreference && levels.includes(reasoningEffortPreference)) {
      return reasoningEffortPreference;
    }
    return levels.includes("medium") ? "medium" : (levels[0] ?? null);
  }, [model, reasoningEffortPreference]);

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

  const setReasoningEffort = useCallback((v: ReasoningEffortLevel) => {
    setReasoningEffortPreferenceState(v);
    updateGlobalConfig({ reasoningEffort: v });
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceInputState((v) => {
      const next = !v;
      updateGlobalConfig({ voiceInput: next });
      return next;
    });
  }, []);

  const toggleInfoSidebar = useCallback(() => {
    setInfoSidebarVisible((v) => {
      const next = !v;
      updateGlobalConfig({ infoSidebarVisible: next });
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
        modelDisplayName,
        setModel,
        autoModeSwitch,
        setAutoModeSwitch,
        reasoningEffort,
        setReasoningEffort,
        voiceInput,
        toggleVoice,
        infoSidebarVisible,
        toggleInfoSidebar,
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

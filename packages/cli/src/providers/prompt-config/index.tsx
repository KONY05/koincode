import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_CHAT_MODEL_ID,
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
  isCustomOrOllamaModelId,
  getReasoningEffortLevels,
  Mode,
  type AgentId,
  type ReasoningEffortLevel,
} from "@koincode/shared";
import { loadPrimaryAgents, type ResolvedAgent } from "../../lib/agents";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";
import { getModelDisplayName } from "../../lib/custom-models";
import { trackModelChanged } from "../../lib/analytics";
import { FALLBACK_MODEL_ID } from "../../../../shared/src/models";

type PromptConfigContextValue = {
  /** Active agent id. Still called `mode` because it *is* the session's mode —
   *  BUILD and PLAN are now just two entries in a registry user agents also join. */
  mode: AgentId;
  toggleMode: () => void;
  setMode: (mode: AgentId) => void;
  /** The resolved definition for `mode`, falling back to BUILD (Decision 10). */
  agent: ResolvedAgent;
  /** Every agent selectable as a top-level mode, in registry order. */
  primaryAgents: ResolvedAgent[];
  model: string;
  /** `model` resolved for display — custom-model opaque ids swapped for their real modelId. */
  modelDisplayName: string;
  setModel: (model: string) => void;
  /** Model spawnAgent sub-agents use. `null` means inherit the session's current model (the default). */
  subagentModel: string | null;
  /** `subagentModel` resolved for display, or null when inheriting. */
  subagentModelDisplayName: string | null;
  setSubagentModel: (model: string | null) => void;
  autoModeSwitch: "confirm" | "auto";
  setAutoModeSwitch: (v: "confirm" | "auto") => void;
  /** Clamped to what `model` actually supports — null when the current model has no reasoning effort control. */
  reasoningEffort: ReasoningEffortLevel | null;
  setReasoningEffort: (v: ReasoningEffortLevel) => void;
  voiceInput: boolean;
  toggleVoice: () => void;
  infoSidebarVisible: boolean;
  toggleInfoSidebar: () => void;
  /** Decided once per session, before the first message — not a mid-session toggle. See 50-incognito-mode-implementation.md. */
  incognito: boolean;
  setIncognito: (v: boolean) => void;
  toggleIncognito: () => void;
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

// Same validity check as resolveInitialModel's `saved` branch — a stale/deleted
// custom model id left over in config shouldn't silently break sub-agent spawns,
// it should just fall back to inheriting the session model.
function resolveInitialSubagentModel(): string | null {
  const saved = readGlobalConfig().subagentModel;
  if (saved && (findSupportedChatModel(saved) || isCustomOrOllamaModelId(saved))) {
    return saved;
  }
  return null;
}

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setMode] = useState<AgentId>(Mode.BUILD);
  const [model, setModelState] = useState<string>(resolveInitialModel);
  const [subagentModel, setSubagentModelState] = useState<string | null>(
    resolveInitialSubagentModel,
  );
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

  // Not persisted (unlike voiceInput/reasoningEffort/etc.) — same pure in-memory pattern
  // as `mode`, since a session's incognito-ness is decided fresh each time, not a
  // sticky cross-restart preference.
  const [incognito, setIncognitoState] = useState<boolean>(false);

  // Whatever `mode` was right before incognito defaulted it to Plan — restored the
  // moment incognito turns back off (explicit /incognito toggle, or the implicit
  // reset on returning to Home), so defaulting to Plan is a scoped, temporary
  // override rather than something that overwrites the user's actual mode choice.
  // A ref, not state: it's read/written only inside setIncognito's own logic, never
  // rendered, so it doesn't need to trigger a re-render on its own.
  const modeBeforeIncognitoRef = useRef<AgentId | null>(null);

  // Mirrors `mode` into a ref so setIncognito/toggleIncognito can read its *current*
  // value without needing `mode` in their own dependency array. This matters: those
  // two must stay referentially stable forever (like every other setter here) —
  // Home's reset-on-mount effect depends on `setIncognito` itself, so if that
  // reference ever changed identity (e.g. from a `[mode]` dependency), the effect
  // would re-fire on every toggle and immediately revert it — which is exactly the
  // bug this ref fixes.
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const modelDisplayName = useMemo(() => getModelDisplayName(model), [model]);
  const subagentModelDisplayName = useMemo(
    () => (subagentModel ? getModelDisplayName(subagentModel) : null),
    [subagentModel],
  );

  const reasoningEffort = useMemo<ReasoningEffortLevel | null>(() => {
    const levels = getReasoningEffortLevels(model);
    if (!levels) return null;
    if (reasoningEffortPreference && levels.includes(reasoningEffortPreference)) {
      return reasoningEffortPreference;
    }
    return levels.includes("medium") ? "medium" : (levels[0] ?? null);
  }, [model, reasoningEffortPreference]);

  // Recomputed on every render rather than memoized — `loadPrimaryAgents()` re-scans
  // the filesystem on each call (see `lib/agents.ts`), so this is always current.
  // This provider only re-renders on its own state changes (Tab press, model
  // switch, etc.), not on every keystroke elsewhere in the app, so re-scanning a
  // handful of small markdown files here is not a hot path.
  const primaryAgents = loadPrimaryAgents();

  const agent = useMemo(
    () =>
      primaryAgents.find((a) => a.id.toLowerCase() === mode.toLowerCase()) ??
      primaryAgents.find((a) => a.id === Mode.BUILD) ??
      primaryAgents[0]!,
    [primaryAgents, mode],
  );

  // Tab cycles through primary agents in registry order. With only the two
  // built-ins present this is exactly the old BUILD ↔ PLAN toggle.
  const toggleMode = useCallback(() => {
    setMode((m) => {
      const index = primaryAgents.findIndex(
        (a) => a.id.toLowerCase() === m.toLowerCase(),
      );
      const next = primaryAgents[(index + 1) % primaryAgents.length];
      return next?.id ?? m;
    });
  }, [primaryAgents]);

  const setModel = useCallback((m: string) => {
    setModelState(m);
    updateGlobalConfig({ defaultModel: m });
    trackModelChanged({ model: m });
  }, []);

  const setSubagentModel = useCallback((m: string | null) => {
    setSubagentModelState(m);
    updateGlobalConfig({ subagentModel: m ?? "" });
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

  // Runs the mode default/restore side effect for a given transition — called from
  // both setIncognito and toggleIncognito's functional updaters below, at the moment
  // React actually applies the state change, so it always sees the latest `mode`
  // (via modeRef) regardless of how stale the enclosing callback's own closure is.
  const applyModeForIncognitoChange = (next: boolean) => {
    if (next) {
      modeBeforeIncognitoRef.current = modeRef.current;
      setMode(Mode.PLAN);
    } else if (modeBeforeIncognitoRef.current !== null) {
      setMode(modeBeforeIncognitoRef.current);
      modeBeforeIncognitoRef.current = null;
    }
  };

  const setIncognito = useCallback((next: boolean) => {
    setIncognitoState((prev) => {
      if (next === prev) return prev;
      applyModeForIncognitoChange(next);
      return next;
    });
  }, []);

  const toggleIncognito = useCallback(() => {
    setIncognitoState((prev) => {
      const next = !prev;
      applyModeForIncognitoChange(next);
      return next;
    });
  }, []);

  return (
    <PromptConfigContext.Provider
      value={{
        mode,
        toggleMode,
        setMode,
        agent,
        primaryAgents,
        model,
        modelDisplayName,
        setModel,
        subagentModel,
        subagentModelDisplayName,
        setSubagentModel,
        autoModeSwitch,
        setAutoModeSwitch,
        reasoningEffort,
        setReasoningEffort,
        voiceInput,
        toggleVoice,
        infoSidebarVisible,
        toggleInfoSidebar,
        incognito,
        setIncognito,
        toggleIncognito,
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

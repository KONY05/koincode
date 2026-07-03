import { useEffect, useRef, useState } from "react";
import { TextAttributes, InputRenderableEvents } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";
import {
  customModelInputSchema,
  customProviderInputSchema,
  type CustomModelInput,
  type CustomProviderInput,
} from "@koincode/shared";

type TextStepProps = {
  layerId: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

/** Single-field text entry step — one field per screen, enter to continue, esc to go back. */
export function TextStep({
  layerId,
  label,
  initialValue = "",
  placeholder,
  error,
  hint = "enter to continue · esc to go back",
  onSubmit,
  onCancel,
}: TextStepProps) {
  const inputRef = useRef<InputRenderable>(null);
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  // InputRenderable overrides submit() to emit "enter" (not "submit" — that's a
  // TextareaRenderable-only mechanism the imperative `.onSubmit =` property relies on),
  // and the JSX `onSubmit` prop's type is an unusable intersection of the Textarea-core
  // option (SubmitEvent) and the React-only Input variant (string). Subscribe directly.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleEnter = (value: string) => onSubmit(value);

    input.on(InputRenderableEvents.ENTER, handleEnter);

    return () => {
      input.off(InputRenderableEvents.ENTER, handleEnter);
    };
  }, [onSubmit]);

  useEffect(() => {
    inputRef.current?.setText(initialValue);
  }, [initialValue]);

  useKeyboard((key) => {
    if (!isTopLayer(layerId)) return;
    if (key.name === "escape") {
      key.preventDefault();
      onCancel();
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <text>{label}</text>
      <input
        ref={inputRef}
        focused={isTopLayer(layerId)}
        placeholder={placeholder}
      />
      {error && (
        <text fg={colors.error} attributes={TextAttributes.BOLD}>
          {error}
        </text>
      )}
      <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
        {hint}
      </text>
    </box>
  );
}

type BooleanStepProps = {
  layerId: string;
  label: string;
  initialValue?: boolean;
  onSubmit: (value: boolean) => void;
  onCancel: () => void;
};

/** Yes/No picker — OpenTUI has no checkbox primitive, so this mirrors the option-list idiom. */
export function BooleanStep({
  layerId,
  label,
  initialValue = false,
  onSubmit,
  onCancel,
}: BooleanStepProps) {
  const [selectedIndex, setSelectedIndex] = useState(initialValue ? 0 : 1);
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();
  const options = [
    { label: "Yes", value: true },
    { label: "No", value: false },
  ];

  useKeyboard((key) => {
    if (!isTopLayer(layerId)) return;
    if (key.name === "escape") {
      key.preventDefault();
      onCancel();
    } else if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      onSubmit(options[selectedIndex]!.value);
    } else if (key.sequence === "1") {
      key.preventDefault();
      onSubmit(true);
    } else if (key.sequence === "2") {
      key.preventDefault();
      onSubmit(false);
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <text>{label}</text>
      <box gap={0}>
        {options.map((opt, i) => {
          const isSelected = i === selectedIndex;
          return (
            <box
              key={opt.label}
              flexDirection="row"
              gap={1}
              height={1}
              onMouseMove={() => setSelectedIndex(i)}
              onMouseDown={() => onSubmit(opt.value)}
            >
              <text
                fg={isSelected ? colors.primary : colors.dimSeparator}
                attributes={isSelected ? TextAttributes.BOLD : undefined}
              >
                {isSelected ? "› " : "  "}[{i + 1}]
              </text>
              <text fg={isSelected ? "white" : "gray"}>{opt.label}</text>
            </box>
          );
        })}
      </box>
      <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
        ↑↓ + enter · esc to go back
      </text>
    </box>
  );
}

export type ProviderFieldsStep = "name" | "baseURL" | "apiKey";

export type ProviderFieldsDraft = {
  name: string;
  baseURL: string;
  apiKey: string;
};

const EMPTY_PROVIDER_DRAFT: ProviderFieldsDraft = { name: "", baseURL: "", apiKey: "" };

type ProviderFieldsWizardProps = {
  layerId: string;
  initialStep?: ProviderFieldsStep;
  initialDraft?: Partial<ProviderFieldsDraft>;
  onComplete: (input: CustomProviderInput) => void;
  onCancel: () => void;
};

/**
 * Runs the name → baseURL → apiKey sequence shared by "/setup add provider" (chains into
 * ModelFieldsWizard on completion) and "/setup edit provider" (saves directly on completion).
 */
export function ProviderFieldsWizard({
  layerId,
  initialStep = "name",
  initialDraft,
  onComplete,
  onCancel,
}: ProviderFieldsWizardProps) {
  const [step, setStep] = useState<ProviderFieldsStep>(initialStep);
  const [draft, setDraft] = useState<ProviderFieldsDraft>({
    ...EMPTY_PROVIDER_DRAFT,
    ...initialDraft,
  });
  const [error, setError] = useState<string | null>(null);

  const back = (from: ProviderFieldsStep) => {
    setError(null);
    if (from === "name") onCancel();
    else if (from === "baseURL") setStep("name");
    else if (from === "apiKey") setStep("baseURL");
  };

  if (step === "name") {
    return (
      <TextStep
        key="name"
        layerId={layerId}
        label="Provider name (e.g. Groq, Mistral, LM Studio):"
        initialValue={draft.name}
        placeholder="Provider name"
        error={error}
        onCancel={() => back("name")}
        onSubmit={(value) => {
          const result = customProviderInputSchema.shape.name.safeParse(value);
          if (!result.success) {
            setError(result.error.issues[0]?.message ?? "Invalid name");
            return;
          }
          setError(null);
          setDraft((d) => ({ ...d, name: result.data }));
          setStep("baseURL");
        }}
      />
    );
  }

  if (step === "baseURL") {
    return (
      <TextStep
        key="baseURL"
        layerId={layerId}
        label="Base URL:"
        initialValue={draft.baseURL}
        placeholder="https://api.example.com/openai/v1"
        error={error}
        onCancel={() => back("baseURL")}
        onSubmit={(value) => {
          const result = customProviderInputSchema.shape.baseURL.safeParse(value);
          if (!result.success) {
            setError(result.error.issues[0]?.message ?? "Must be a valid URL");
            return;
          }
          setError(null);
          setDraft((d) => ({ ...d, baseURL: result.data }));
          setStep("apiKey");
        }}
      />
    );
  }

  return (
    <TextStep
      key="apiKey"
      layerId={layerId}
      label="API key (optional — leave blank for unauthenticated local servers):"
      initialValue={draft.apiKey}
      placeholder="sk-..."
      error={error}
      onCancel={() => back("apiKey")}
      onSubmit={(value) => {
        const trimmed = value.trim();
        if (trimmed === "") {
          setError(null);
          setDraft((d) => ({ ...d, apiKey: "" }));
          onComplete({ name: draft.name, baseURL: draft.baseURL, apiKey: undefined });
          return;
        }
        const result = customProviderInputSchema.shape.apiKey.safeParse(trimmed);
        if (!result.success) {
          setError(result.error.issues[0]?.message ?? "Invalid API key");
          return;
        }
        setError(null);
        setDraft((d) => ({ ...d, apiKey: trimmed }));
        onComplete({ name: draft.name, baseURL: draft.baseURL, apiKey: result.data });
      }}
    />
  );
}

export type ModelFieldsStep = "modelId" | "contextWindow" | "vision";

export type ModelFieldsDraft = {
  modelId: string;
  contextWindow: string;
  vision: boolean;
};

const EMPTY_MODEL_DRAFT: ModelFieldsDraft = { modelId: "", contextWindow: "", vision: false };

type ModelFieldsWizardProps = {
  layerId: string;
  initialDraft?: Partial<ModelFieldsDraft>;
  onComplete: (input: CustomModelInput) => void;
  onCancel: () => void;
};

/**
 * Runs the modelId → contextWindow → vision sequence shared by "/setup add provider"
 * (its trailing model step) and "/models Custom tab: + Add model".
 */
export function ModelFieldsWizard({
  layerId,
  initialDraft,
  onComplete,
  onCancel,
}: ModelFieldsWizardProps) {
  const [step, setStep] = useState<ModelFieldsStep>("modelId");
  const [draft, setDraft] = useState<ModelFieldsDraft>({
    ...EMPTY_MODEL_DRAFT,
    ...initialDraft,
  });
  const [error, setError] = useState<string | null>(null);

  const back = (from: ModelFieldsStep) => {
    setError(null);
    if (from === "modelId") onCancel();
    else if (from === "contextWindow") setStep("modelId");
    else if (from === "vision") setStep("contextWindow");
  };

  if (step === "modelId") {
    return (
      <TextStep
        key="modelId"
        layerId={layerId}
        label="Model id (the exact string sent to the provider's API, e.g. mistralai/Mistral-7B-Instruct-v0.3):"
        initialValue={draft.modelId}
        placeholder="model-id"
        error={error}
        onCancel={() => back("modelId")}
        onSubmit={(value) => {
          const result = customModelInputSchema.shape.modelId.safeParse(value);
          if (!result.success) {
            setError(result.error.issues[0]?.message ?? "Invalid model id");
            return;
          }
          setError(null);
          setDraft((d) => ({ ...d, modelId: result.data }));
          setStep("contextWindow");
        }}
      />
    );
  }

  if (step === "contextWindow") {
    return (
      <TextStep
        key="contextWindow"
        layerId={layerId}
        label="Context window in tokens (optional — leave blank to skip):"
        initialValue={draft.contextWindow}
        placeholder="128000"
        error={error}
        onCancel={() => back("contextWindow")}
        onSubmit={(value) => {
          const trimmed = value.trim();
          if (trimmed === "") {
            setError(null);
            setDraft((d) => ({ ...d, contextWindow: "" }));
            setStep("vision");
            return;
          }
          const result = customModelInputSchema.shape.contextWindow.safeParse(trimmed);
          if (!result.success) {
            setError(result.error.issues[0]?.message ?? "Invalid context window");
            return;
          }
          setError(null);
          setDraft((d) => ({ ...d, contextWindow: trimmed }));
          setStep("vision");
        }}
      />
    );
  }

  return (
    <BooleanStep
      key="vision"
      layerId={layerId}
      label="Does this model support image input (vision)?"
      initialValue={draft.vision}
      onCancel={() => back("vision")}
      onSubmit={(vision) => {
        const finalDraft = { ...draft, vision };
        setDraft(finalDraft);
        const contextWindow =
          finalDraft.contextWindow.trim() === ""
            ? undefined
            : Number(finalDraft.contextWindow);
        onComplete({ modelId: finalDraft.modelId, contextWindow, vision });
      }}
    />
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import {
  readGlobalConfig,
  updateGlobalConfig,
} from "../../utils/configs/global-config";
import {
  listCustomProviders,
  customModelsForProvider,
  addCustomProviderWithModel,
  updateCustomProvider,
  deleteCustomProvider,
} from "../../lib/custom-models";
import { restartServer } from "../../lib/server-manager";
import type { ApiKeys, CustomProviderConfig, KoincodeGlobalConfig } from "@koincode/shared";
import { TEXTAREA_KEY_BINDINGS } from "../input-bar";
import { ProviderFieldsWizard, ModelFieldsWizard } from "./model-field-steps";

type ApiKeyName = keyof ApiKeys;

type ProviderEntry = {
  key: ApiKeyName;
  label: string;
};

const PROVIDERS: ProviderEntry[] = [
  { key: "openrouter", label: "OpenRouter" },
  { key: "anthropic", label: "Anthropic" },
  { key: "openai", label: "OpenAI" },
  { key: "google", label: "Google" },
  { key: "xai", label: "xAI" },
];

const UNDO_DURATION_MS = 5000;

function maskKey(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 6)}****`;
}

type EditKeyViewProps = {
  providerLabel: string;
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
};

function EditKeyView({
  providerLabel,
  initialValue,
  onSave,
  onCancel,
}: EditKeyViewProps) {
  const textareaRef = useRef<TextareaRenderable>(null);
  const { isTopLayer } = useKeyboardLayer();

  // Re-wire onSubmit if onSave identity changes (it won't while this component is mounted,
  // but this keeps the effect semantically correct).
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.onSubmit = () => {
      onSave(textarea.plainText ?? "");
    };
  }, [onSave]);

  // Pre-populate with the existing key value on mount.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.setText(initialValue);
  }, [initialValue]);

  useKeyboard((key) => {
    if (!isTopLayer("setup-edit")) return;
    if (key.name === "escape") {
      key.preventDefault();
      onCancel();
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <text>{providerLabel} API key:</text>
      <textarea
        ref={textareaRef}
        focused={isTopLayer("setup-edit")}
        keyBindings={TEXTAREA_KEY_BINDINGS}
        placeholder="Paste your key here..."
      />
      <text attributes={TextAttributes.DIM}>enter to save · esc to cancel</text>
    </box>
  );
}

// ── Combined row list: fixed built-ins + dynamic custom providers + "add" row ──────

type Row =
  | { kind: "builtin"; provider: ProviderEntry }
  | { kind: "custom"; provider: CustomProviderConfig }
  | { kind: "add" };

function buildRows(customProviders: CustomProviderConfig[]): Row[] {
  return [
    ...PROVIDERS.map((provider) => ({ kind: "builtin" as const, provider })),
    ...customProviders.map((provider) => ({ kind: "custom" as const, provider })),
    { kind: "add" as const },
  ];
}

type KeyListViewProps = {
  config: KoincodeGlobalConfig;
  rows: Row[];
  selectedIndex: number;
  onSelect: (row: Row) => void;
};

function KeyListView({ config, rows, selectedIndex, onSelect }: KeyListViewProps) {
  const { colors } = useTheme();
  const hasCustom = rows.some((r) => r.kind === "custom");

  return (
    <box flexDirection="column" gap={0}>
      {rows.map((row, i) => {
        const isSelected = i === selectedIndex;

        if (row.kind === "builtin") {
          const value = config.apiKeys?.[row.provider.key];
          return (
            <box
              key={row.provider.key}
              flexDirection="row"
              height={1}
              paddingX={1}
              backgroundColor={isSelected ? colors.selection : undefined}
              onMouseDown={() => onSelect(row)}
            >
              <box width={16} flexShrink={0}>
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                  {row.provider.label}
                </text>
              </box>
              <box flexGrow={1}>
                <text
                  selectable={false}
                  fg={isSelected ? "black" : value ? "gray" : colors.dimSeparator}
                  attributes={value ? undefined : TextAttributes.DIM}
                >
                  {maskKey(value)}
                </text>
              </box>
            </box>
          );
        }

        if (row.kind === "custom") {
          const modelCount = customModelsForProvider(row.provider.id).length;
          return (
            <box
              key={row.provider.id}
              flexDirection="row"
              height={1}
              paddingX={1}
              backgroundColor={isSelected ? colors.selection : undefined}
              onMouseDown={() => onSelect(row)}
            >
              <box width={16} flexShrink={0}>
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                  {row.provider.name}
                </text>
              </box>
              <box flexGrow={1} flexDirection="row" gap={2}>
                <text
                  selectable={false}
                  fg={isSelected ? "black" : "gray"}
                >
                  {maskKey(row.provider.apiKey)}
                </text>
                <text
                  selectable={false}
                  fg={isSelected ? "black" : colors.dimSeparator}
                  attributes={TextAttributes.DIM}
                >
                  {modelCount} model{modelCount === 1 ? "" : "s"}
                </text>
              </box>
            </box>
          );
        }

        return (
          <box
            key="add"
            height={1}
            paddingX={1}
            marginTop={hasCustom ? 0 : 1}
            backgroundColor={isSelected ? colors.selection : undefined}
            onMouseDown={() => onSelect(row)}
          >
            <text
              selectable={false}
              fg={isSelected ? "black" : colors.primary}
              attributes={TextAttributes.BOLD}
            >
              + Add provider
            </text>
          </box>
        );
      })}
      <box marginTop={1} paddingX={1}>
        <text attributes={TextAttributes.DIM}>
          ↑↓ navigate · enter to edit/select · + add provider · ctrl+d delete custom provider · esc to close
        </text>
      </box>
    </box>
  );
}

// ── Add/edit provider wizard state ──────────────────────────────────────────────

type CustomView =
  | {
      kind: "provider-wizard";
      forNewProvider: boolean;
      providerId?: string;
      initialStep: "name" | "baseURL" | "apiKey";
      draft: { name: string; baseURL: string; apiKey: string };
    }
  | { kind: "add-provider-model"; providerInput: { name: string; baseURL: string; apiKey?: string } }
  | null;

export function SetupDialogContent() {
  const [config, setConfig] = useState<KoincodeGlobalConfig>(() =>
    readGlobalConfig(),
  );
  const [customProviders, setCustomProviders] = useState<CustomProviderConfig[]>(() =>
    listCustomProviders(),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingKey, setEditingKey] = useState<ApiKeyName | null>(null);
  const [customView, setCustomView] = useState<CustomView>(null);
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const toast = useToast();

  const pendingDeleteRef = useRef<{
    provider: CustomProviderConfig;
    modelCount: number;
    index: number;
    timerId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const rows = buildRows(customProviders);

  const commitDelete = useCallback((providerId: string) => {
    deleteCustomProvider(providerId);
  }, []);

  // Flush any pending delete on unmount so it isn't silently lost.
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
        commitDelete(pendingDeleteRef.current.provider.id);
        pendingDeleteRef.current = null;
      }
    };
  }, [commitDelete]);

  const startEdit = useCallback(
    (key: ApiKeyName) => {
      setEditingKey(key);
      push("setup-edit", () => {
        setEditingKey(null);
        return true;
      });
    },
    [push],
  );

  const handleSave = useCallback(
    (key: ApiKeyName, value: string) => {
      const newConfig = updateGlobalConfig({
        apiKeys: { [key]: value.trim() || undefined },
      });
      setConfig(newConfig);
      setEditingKey(null);
      pop("setup-edit");
      void restartServer().catch(() => {});
      toast.show({
        message: "Key saved — server restarting",
        variant: "success",
      });
    },
    [pop, toast],
  );

  // Stable save callback for the currently-edited key. editingKey doesn't
  // change while EditKeyView is mounted, so this ref is stable for its lifetime.
  const handleSaveCurrentKey = useCallback(
    (value: string) => {
      if (editingKey) handleSave(editingKey, value);
    },
    [editingKey, handleSave],
  );

  const handleCancel = useCallback(() => {
    setEditingKey(null);
    pop("setup-edit");
  }, [pop]);

  const startAddProvider = useCallback(() => {
    setCustomView({
      kind: "provider-wizard",
      forNewProvider: true,
      initialStep: "name",
      draft: { name: "", baseURL: "", apiKey: "" },
    });
    push("setup-wizard", () => {
      setCustomView(null);
      return true;
    });
  }, [push]);

  const startEditProvider = useCallback(
    (provider: CustomProviderConfig) => {
      setCustomView({
        kind: "provider-wizard",
        forNewProvider: false,
        providerId: provider.id,
        initialStep: "name",
        draft: { name: provider.name, baseURL: provider.baseURL, apiKey: provider.apiKey ?? "" },
      });
      push("setup-wizard", () => {
        setCustomView(null);
        return true;
      });
    },
    [push],
  );

  const exitWizard = useCallback(() => {
    setCustomView(null);
    pop("setup-wizard");
  }, [pop]);

  useKeyboard((key) => {
    if (editingKey || customView || !isTopLayer("dialog")) return;

    if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      const row = rows[selectedIndex];
      if (!row) return;
      if (row.kind === "builtin") startEdit(row.provider.key);
      else if (row.kind === "custom") startEditProvider(row.provider);
      else startAddProvider();
    } else if (key.sequence === "+") {
      key.preventDefault();
      startAddProvider();
    } else if (key.ctrl && key.name === "d") {
      const row = rows[selectedIndex];
      if (!row || row.kind !== "custom") return;
      key.preventDefault();

      // Flush any existing pending delete before starting a new one.
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
        commitDelete(pendingDeleteRef.current.provider.id);
        pendingDeleteRef.current = null;
      }

      const provider = row.provider;
      const modelCount = customModelsForProvider(provider.id).length;
      const index = customProviders.findIndex((p) => p.id === provider.id);
      if (index === -1) return;

      const timerId = setTimeout(() => {
        pendingDeleteRef.current = null;
        commitDelete(provider.id);
      }, UNDO_DURATION_MS);
      pendingDeleteRef.current = { provider, modelCount, index, timerId };

      setCustomProviders((prev) => prev.filter((p) => p.id !== provider.id));

      setSelectedIndex((i) => Math.min(i, rows.length - 2));

      toast.show({
        variant: "info",
        message:
          modelCount > 0
            ? `Deleted ${provider.name} and ${modelCount} model${modelCount === 1 ? "" : "s"} — Ctrl+U to undo`
            : `Deleted ${provider.name} — Ctrl+U to undo`,
        duration: UNDO_DURATION_MS,
      });
    } else if (key.ctrl && key.name === "u" && pendingDeleteRef.current) {
      key.preventDefault();
      const { provider, index, timerId } = pendingDeleteRef.current;
      clearTimeout(timerId);
      pendingDeleteRef.current = null;

      setCustomProviders((prev) => {
        const restored = [...prev];
        restored.splice(index, 0, provider);
        return restored;
      });

      toast.show({ variant: "success", message: "Provider restored" });
    }
  });

  if (editingKey) {
    const provider = PROVIDERS.find((p) => p.key === editingKey)!;
    return (
      <EditKeyView
        providerLabel={provider.label}
        initialValue={config.apiKeys?.[editingKey] ?? ""}
        onSave={handleSaveCurrentKey}
        onCancel={handleCancel}
      />
    );
  }

  if (customView?.kind === "provider-wizard") {
    return (
      <ProviderFieldsWizard
        layerId="setup-wizard"
        initialStep={customView.initialStep}
        initialDraft={customView.draft}
        onCancel={exitWizard}
        onComplete={(input) => {
          if (customView.forNewProvider) {
            setCustomView({ kind: "add-provider-model", providerInput: input });
          } else {
            updateCustomProvider(customView.providerId!, input);
            setCustomProviders(listCustomProviders());
            exitWizard();
            toast.show({ variant: "success", message: "Provider updated" });
          }
        }}
      />
    );
  }

  if (customView?.kind === "add-provider-model") {
    return (
      <ModelFieldsWizard
        layerId="setup-wizard"
        onCancel={() =>
          setCustomView({
            kind: "provider-wizard",
            forNewProvider: true,
            initialStep: "apiKey",
            draft: {
              name: customView.providerInput.name,
              baseURL: customView.providerInput.baseURL,
              apiKey: customView.providerInput.apiKey ?? "",
            },
          })
        }
        onComplete={(modelInput) => {
          addCustomProviderWithModel(customView.providerInput, modelInput);
          setCustomProviders(listCustomProviders());
          exitWizard();
          toast.show({ variant: "success", message: "Provider and model added" });
        }}
      />
    );
  }

  return (
    <KeyListView
      config={config}
      rows={rows}
      selectedIndex={Math.min(selectedIndex, rows.length - 1)}
      onSelect={(row) => {
        setSelectedIndex(rows.indexOf(row));
        if (row.kind === "builtin") startEdit(row.provider.key);
        else if (row.kind === "custom") startEditProvider(row.provider);
        else startAddProvider();
      }}
    />
  );
}

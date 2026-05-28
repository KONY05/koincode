import { useState, useEffect, useRef, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { readConfig, updateConfig } from "../../lib/config";
import { restartServer } from "../../lib/server-manager";
import type { KoincodeConfig } from "@koincode/shared";
import { TEXTAREA_KEY_BINDINGS } from "../input-bar";

type ProviderEntry = {
  key: keyof KoincodeConfig;
  label: string;
};

const PROVIDERS: ProviderEntry[] = [
  { key: "openrouterKey", label: "OpenRouter" },
  { key: "anthropicKey",  label: "Anthropic"  },
  { key: "openaiKey",     label: "OpenAI"     },
  { key: "geminiKey",     label: "Gemini"     },
];

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

function EditKeyView({ providerLabel, initialValue, onSave, onCancel }: EditKeyViewProps) {
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

type KeyListViewProps = {
  config: KoincodeConfig;
  selectedIndex: number;
  onSelect: (key: keyof KoincodeConfig) => void;
};

function KeyListView({ config, selectedIndex, onSelect }: KeyListViewProps) {
  const { colors } = useTheme();

  return (
    <box flexDirection="column" gap={0}>
      {PROVIDERS.map((provider, i) => {
        const isSelected = i === selectedIndex;
        const value = config[provider.key];

        return (
          <box
            key={provider.key}
            flexDirection="row"
            height={1}
            paddingX={1}
            backgroundColor={isSelected ? colors.selection : undefined}
            onMouseDown={() => onSelect(provider.key)}
          >
            <box width={14} flexShrink={0}>
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {provider.label}
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
      })}
      <box marginTop={1} paddingX={1}>
        <text attributes={TextAttributes.DIM}>↑↓ navigate · enter to edit · esc to close</text>
      </box>
    </box>
  );
}

export function SetupDialogContent() {
  const [config, setConfig] = useState<KoincodeConfig>(() => readConfig());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingKey, setEditingKey] = useState<keyof KoincodeConfig | null>(null);
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const toast = useToast();

  const startEdit = useCallback(
    (key: keyof KoincodeConfig) => {
      setEditingKey(key);
      push("setup-edit", () => {
        setEditingKey(null);
        return true;
      });
    },
    [push],
  );

  const handleSave = useCallback(
    (key: keyof KoincodeConfig, value: string) => {
      const newConfig = updateConfig({ [key]: value.trim() || undefined });
      setConfig(newConfig);
      setEditingKey(null);
      pop("setup-edit");
      void restartServer().catch(() => {});
      toast.show({ message: "Key saved — server restarting", variant: "success" });
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

  useKeyboard((key) => {
    if (editingKey || !isTopLayer("dialog")) return;

    if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      const provider = PROVIDERS[selectedIndex];
      if (provider) startEdit(provider.key);
    }
  });

  if (editingKey) {
    const provider = PROVIDERS.find((p) => p.key === editingKey)!;
    return (
      <EditKeyView
        providerLabel={provider.label}
        initialValue={config[editingKey] ?? ""}
        onSave={handleSaveCurrentKey}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <KeyListView
      config={config}
      selectedIndex={selectedIndex}
      onSelect={(key) => {
        setSelectedIndex(PROVIDERS.findIndex((p) => p.key === key));
        startEdit(key);
      }}
    />
  );
}

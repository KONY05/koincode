import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { DialogSearchList } from "../dialog-search-list";
import {
  listCustomModels,
  listCustomProviders,
  addCustomModel,
  deleteCustomModel,
} from "../../lib/custom-models";
import { apiClient } from "../../lib/api-client";
import {
  DEFAULT_OLLAMA_BASE_URL,
  type SupportedChatModel,
  type OllamaModelsResponse,
  type CustomModelConfig,
  type CustomProviderConfig,
} from "@koincode/shared";
import { ModelFieldsWizard } from "./model-field-steps";

type Tab = "frontier" | "free" | "custom" | "ollama";

const UNDO_DURATION_MS = 5000;

function isFree(model: SupportedChatModel): boolean {
  return (
    model.pricing.inputUsdPerMillionTokens === 0 &&
    model.pricing.outputUsdPerMillionTokens === 0
  );
}

type OllamaModel = { id: string; name: string; size?: number };
type CustomRow = { kind: "model"; model: CustomModelConfig } | { kind: "add" };

function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / 1_000_000).toFixed(0)}MB`;
}

type ModelsDialogContentProps = {
  models: readonly SupportedChatModel[];
  onSelectModel: (modelId: string) => void;
};

// ── Custom tab sub-views: pick a provider, then run the model-fields wizard ────────

type CustomSubView =
  | { kind: "pick-provider" }
  | { kind: "model-wizard"; providerId: string }
  | null;

type ProviderPickerProps = {
  providers: CustomProviderConfig[];
  onSelect: (provider: CustomProviderConfig) => void;
  onCancel: () => void;
};

function ProviderPicker({
  providers,
  onSelect,
  onCancel,
}: ProviderPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  useKeyboard((key) => {
    if (!isTopLayer("models-wizard")) return;
    if (key.name === "escape") {
      key.preventDefault();
      onCancel();
    } else if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((i) => Math.min(providers.length - 1, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      const provider = providers[selectedIndex];
      if (provider) onSelect(provider);
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <text>Add model to which provider?</text>
      <box gap={0}>
        {providers.map((provider, i) => {
          const isSelected = i === selectedIndex;
          return (
            <box
              key={provider.id}
              flexDirection="row"
              height={1}
              paddingX={1}
              backgroundColor={isSelected ? colors.selection : undefined}
              onMouseMove={() => setSelectedIndex(i)}
              onMouseDown={() => onSelect(provider)}
            >
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {provider.name}
              </text>
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

export const ModelsDialogContent = ({
  models,
  onSelectModel,
}: ModelsDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();
  const toast = useToast();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const [activeTab, setActiveTab] = useState<Tab>("frontier");
  const [ollamaData, setOllamaData] = useState<OllamaModelsResponse | null>(
    null,
  );
  const fetchedRef = useRef(false);

  const [customModels, setCustomModels] = useState<CustomModelConfig[]>(() =>
    listCustomModels(),
  );
  const [customProviders] = useState<CustomProviderConfig[]>(() =>
    listCustomProviders(),
  );
  const [customSubView, setCustomSubView] = useState<CustomSubView>(null);
  const highlightedCustomRef = useRef<CustomModelConfig | null>(null);
  const pendingDeleteRef = useRef<{
    model: CustomModelConfig;
    index: number;
    timerId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const TABS: { id: Tab; label: string; activeColor: string }[] = [
    { id: "frontier", label: "Frontier", activeColor: colors.primary },
    { id: "free", label: "Free", activeColor: colors.success },
    { id: "custom", label: "Custom", activeColor: colors.info },
    { id: "ollama", label: "Ollama", activeColor: colors.info },
  ];

  const frontierModels = models.filter(
    (m) => !isFree(m),
  ) as SupportedChatModel[];
  const freeModels = models.filter(isFree) as SupportedChatModel[];

  // loadingLocal: the ollama tab is active but we haven't received the live detection result yet
  const loadingLocal = activeTab === "ollama" && ollamaData === null;

  useEffect(() => {
    if (activeTab !== "ollama" || fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      try {
        const res = await apiClient["ollama-models"].$get();
        const data = await res.json();
        setOllamaData(data);
      } catch {
        setOllamaData({ ollama: null });
      }
    })();
  }, [activeTab]);

  const ollamaModels: OllamaModel[] = ollamaData?.ollama ?? [];

  const commitDeleteModel = useCallback((modelId: string) => {
    deleteCustomModel(modelId);
  }, []);

  // Flush any pending delete on unmount so it isn't silently lost.
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
        commitDeleteModel(pendingDeleteRef.current.model.id);
        pendingDeleteRef.current = null;
      }
    };
  }, [commitDeleteModel]);

  const handleSelectStatic = useCallback(
    (model: SupportedChatModel) => {
      onSelectModel(model.id);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  const handleSelectOllama = useCallback(
    (model: OllamaModel) => {
      onSelectModel(model.id);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  const startAddModel = useCallback(() => {
    if (customProviders.length === 0) {
      toast.show({
        variant: "error",
        message: "No custom providers yet — run /setup to add one first.",
      });
      return;
    }
    setCustomSubView({ kind: "pick-provider" });
    push("models-wizard", () => {
      setCustomSubView(null);
      return true;
    });
  }, [customProviders, push, toast]);

  const exitCustomWizard = useCallback(() => {
    setCustomSubView(null);
    pop("models-wizard");
  }, [pop]);

  const handleSelectCustom = useCallback(
    (row: CustomRow) => {
      if (row.kind === "add") {
        startAddModel();
        return;
      }
      onSelectModel(row.model.id);
      dialog.close();
    },
    [dialog, onSelectModel, startAddModel],
  );

  const customRows: CustomRow[] = [
    { kind: "add" },
    ...customModels.map((model) => ({ kind: "model" as const, model })),
  ];

  useKeyboard((key) => {
    if (key.name === "tab" && isTopLayer("dialog")) {
      setActiveTab((t) => {
        const ids = TABS.map((tab) => tab.id);
        return ids[(ids.indexOf(t) + 1) % ids.length]!;
      });
      return;
    }

    if (activeTab !== "custom" || !isTopLayer("dialog")) return;

    if (key.sequence === "+") {
      key.preventDefault();
      startAddModel();
    } else if (key.ctrl && key.name === "d") {
      const target = highlightedCustomRef.current;
      if (!target) return;
      key.preventDefault();

      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
        commitDeleteModel(pendingDeleteRef.current.model.id);
        pendingDeleteRef.current = null;
      }

      const index = customModels.findIndex((m) => m.id === target.id);
      if (index === -1) return;

      const timerId = setTimeout(() => {
        pendingDeleteRef.current = null;
        commitDeleteModel(target.id);
      }, UNDO_DURATION_MS);

      pendingDeleteRef.current = { model: target, index, timerId };

      setCustomModels((prev) => prev.filter((m) => m.id !== target.id));

      toast.show({
        variant: "info",
        message: `Deleted ${target.modelId} — Ctrl+U to undo`,
        duration: UNDO_DURATION_MS,
      });
    } else if (key.ctrl && key.name === "u" && pendingDeleteRef.current) {
      key.preventDefault();
      const { model, index, timerId } = pendingDeleteRef.current;

      clearTimeout(timerId);

      pendingDeleteRef.current = null;

      setCustomModels((prev) => {
        const restored = [...prev];
        restored.splice(index, 0, model);
        return restored;
      });
      toast.show({ variant: "success", message: "Model restored" });
    }
  });

  if (customSubView?.kind === "pick-provider") {
    return (
      <ProviderPicker
        providers={customProviders}
        onCancel={exitCustomWizard}
        onSelect={(provider) =>
          setCustomSubView({ kind: "model-wizard", providerId: provider.id })
        }
      />
    );
  }

  if (customSubView?.kind === "model-wizard") {
    return (
      <ModelFieldsWizard
        layerId="models-wizard"
        onCancel={() => setCustomSubView({ kind: "pick-provider" })}
        onComplete={(modelInput) => {
          addCustomModel(customSubView.providerId, modelInput);
          setCustomModels(listCustomModels());
          exitCustomWizard();
          toast.show({ variant: "success", message: "Model added" });
        }}
      />
    );
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={3} paddingX={1}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <text
              key={tab.id}
              selectable={false}
              fg={isActive ? tab.activeColor : colors.dimSeparator}
              attributes={isActive ? TextAttributes.BOLD : TextAttributes.DIM}
            >
              {isActive ? "▶ " : "  "}
              {tab.label}
            </text>
          );
        })}
      </box>

      {(activeTab === "frontier" || activeTab === "free") && (
        <DialogSearchList
          key={activeTab}
          items={activeTab === "frontier" ? frontierModels : freeModels}
          onSelect={handleSelectStatic}
          filterFn={(model, query) =>
            model.id.toLowerCase().includes(query.toLowerCase()) ||
            model.provider.toLowerCase().includes(query.toLowerCase())
          }
          renderItem={(model, isSelected) => (
            <box flexGrow={1} paddingX={1}>
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {model.label}
              </text>
            </box>
          )}
          getKey={(model) => model.id}
          placeholder="Search models"
          emptyText="No matching models"
        />
      )}

      {activeTab === "custom" && (
        <DialogSearchList
          key="custom"
          items={customRows}
          onSelect={handleSelectCustom}
          onHighlight={(row) => {
            highlightedCustomRef.current =
              row.kind === "model" ? row.model : null;
          }}
          filterFn={(row, query) =>
            row.kind === "add" ||
            row.model.modelId.toLowerCase().includes(query.toLowerCase())
          }
          renderItem={(row, isSelected) =>
            row.kind === "add" ? (
              <box flexGrow={1} paddingX={1}>
                <text
                  selectable={false}
                  fg={isSelected ? "black" : colors.primary}
                  attributes={TextAttributes.BOLD}
                >
                  + Add model
                </text>
              </box>
            ) : (
              <box flexGrow={1} paddingX={1}>
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                  {row.model.modelId}
                </text>
              </box>
            )
          }
          getKey={(row) => (row.kind === "add" ? "add" : row.model.id)}
          placeholder="Search custom models"
          emptyText="No matching models"
        />
      )}

      {activeTab === "ollama" && loadingLocal && (
        <box paddingX={1}>
          <text
            selectable={false}
            fg={colors.dimSeparator}
            attributes={TextAttributes.DIM}
          >
            Detecting local models…
          </text>
        </box>
      )}

      {activeTab === "ollama" &&
        !loadingLocal &&
        ollamaData?.ollama === null && (
          <box paddingX={1} flexDirection="column" gap={1}>
            <text selectable={false} fg={colors.dimSeparator}>
              Ollama not detected at {DEFAULT_OLLAMA_BASE_URL}
            </text>
            <text
              selectable={false}
              fg={colors.dimSeparator}
              attributes={TextAttributes.DIM}
            >
              Install Ollama (ollama.com) and run a model to use it here.
            </text>
          </box>
        )}

      {activeTab === "ollama" && !loadingLocal && ollamaModels.length > 0 && (
        <DialogSearchList
          key="ollama"
          items={ollamaModels}
          onSelect={handleSelectOllama}
          filterFn={(model, query) =>
            model.name.toLowerCase().includes(query.toLowerCase())
          }
          renderItem={(model, isSelected) => (
            <box flexGrow={1} paddingX={1} flexDirection="row" gap={2}>
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {model.name}
              </text>
              {model.size != null && (
                <text
                  selectable={false}
                  fg={isSelected ? "black" : colors.dimSeparator}
                  attributes={TextAttributes.DIM}
                >
                  {formatBytes(model.size)}
                </text>
              )}
            </box>
          )}
          getKey={(model) => model.id}
          placeholder="Search local models"
          emptyText="No matching models"
        />
      )}

      {activeTab === "ollama" &&
        !loadingLocal &&
        ollamaData?.ollama?.length === 0 && (
          <box paddingX={1}>
            <text
              selectable={false}
              fg={colors.dimSeparator}
              attributes={TextAttributes.DIM}
            >
              No models pulled yet. Run: ollama pull llama3.2
            </text>
          </box>
        )}

      <text
        selectable={false}
        fg={colors.dimSeparator}
        attributes={TextAttributes.DIM}
      >
        {activeTab === "custom"
          ? "Tab · switch tabs · + add model · ctrl+d delete custom model"
          : "Tab · switch tabs"}
      </text>
    </box>
  );
};

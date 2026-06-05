import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { DialogSearchList } from "../dialog-search-list";
import { SERVER_PORT, DEFAULT_OLLAMA_BASE_URL, type SupportedChatModel, type LocalModelsResponse } from "@koincode/shared";

type Tab = "frontier" | "free" | "local";

function isFree(model: SupportedChatModel): boolean {
  return (
    model.pricing.inputUsdPerMillionTokens === 0 &&
    model.pricing.outputUsdPerMillionTokens === 0
  );
}

type OllamaModel = { id: string; name: string; size?: number };

function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / 1_000_000).toFixed(0)}MB`;
}

type ModelsDialogContentProps = {
  models: readonly SupportedChatModel[];
  onSelectModel: (modelId: string) => void;
};

export const ModelsDialogContent = ({
  models,
  onSelectModel,
}: ModelsDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();
  const { isTopLayer } = useKeyboardLayer();
  const [activeTab, setActiveTab] = useState<Tab>("frontier");
  const [localData, setLocalData] = useState<LocalModelsResponse | null>(null);
  const fetchedRef = useRef(false);

  const frontierModels = models.filter((m) => !isFree(m)) as SupportedChatModel[];
  const freeModels = models.filter(isFree) as SupportedChatModel[];

  // loadingLocal: tab is active but we haven't received data yet
  const loadingLocal = activeTab === "local" && localData === null;

  useEffect(() => {
    if (activeTab !== "local" || fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      try {
        const res = await fetch(`http://localhost:${SERVER_PORT}/local-models`);
        const data = (await res.json()) as LocalModelsResponse;
        setLocalData(data);
      } catch {
        setLocalData({ ollama: null, custom: [] });
      }
    })();
  }, [activeTab]);

  const ollamaModels: OllamaModel[] = localData?.ollama ?? [];
  const customModels: OllamaModel[] = (localData?.custom ?? []).map((m) => ({
    id: m.id,
    name: m.displayName ?? m.id,
  }));
  const allLocalModels = [...ollamaModels, ...customModels];

  const handleSelectStatic = useCallback(
    (model: SupportedChatModel) => {
      onSelectModel(model.id);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  const handleSelectLocal = useCallback(
    (model: OllamaModel) => {
      onSelectModel(model.id);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;
    if (key.name === "tab") {
      setActiveTab((t) => {
        if (t === "frontier") return "free";
        if (t === "free") return "local";
        return "frontier";
      });
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={3} paddingX={1}>
        <text
          selectable={false}
          fg={activeTab === "frontier" ? colors.primary : colors.dimSeparator}
          attributes={activeTab === "frontier" ? TextAttributes.BOLD : TextAttributes.DIM}
        >
          {activeTab === "frontier" ? "▶ " : "  "}Frontier
        </text>
        <text
          selectable={false}
          fg={activeTab === "free" ? colors.success : colors.dimSeparator}
          attributes={activeTab === "free" ? TextAttributes.BOLD : TextAttributes.DIM}
        >
          {activeTab === "free" ? "▶ " : "  "}Free
        </text>
        <text
          selectable={false}
          fg={activeTab === "local" ? colors.info : colors.dimSeparator}
          attributes={activeTab === "local" ? TextAttributes.BOLD : TextAttributes.DIM}
        >
          {activeTab === "local" ? "▶ " : "  "}Local
        </text>
      </box>

      {activeTab !== "local" && (
        <DialogSearchList
          key={activeTab}
          items={activeTab === "frontier" ? frontierModels : freeModels}
          onSelect={handleSelectStatic}
          filterFn={(model, query) =>
            model.id.toLowerCase().includes(query.toLowerCase())
          }
          renderItem={(model, isSelected) => (
            <box flexGrow={1} paddingX={1}>
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {model.id}
              </text>
            </box>
          )}
          getKey={(model) => model.id}
          placeholder="Search models"
          emptyText="No matching models"
        />
      )}

      {activeTab === "local" && loadingLocal && (
        <box paddingX={1}>
          <text selectable={false} fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
            Detecting local models…
          </text>
        </box>
      )}

      {activeTab === "local" && !loadingLocal && localData?.ollama === null && (
        <box paddingX={1} flexDirection="column" gap={1}>
          <text selectable={false} fg={colors.dimSeparator}>
            Ollama not detected at {DEFAULT_OLLAMA_BASE_URL}
          </text>
          <text selectable={false} fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
            Install Ollama (ollama.com) and run a model to use it here.
          </text>
        </box>
      )}

      {activeTab === "local" && !loadingLocal && allLocalModels.length > 0 && (
        <DialogSearchList
          key="local"
          items={allLocalModels}
          onSelect={handleSelectLocal}
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

      {activeTab === "local" && !loadingLocal && localData?.ollama?.length === 0 && (
        <box paddingX={1}>
          <text selectable={false} fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
            No models pulled yet. Run: ollama pull llama3.2
          </text>
        </box>
      )}

      <text selectable={false} fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
        Tab · switch tabs
      </text>
    </box>
  );
};

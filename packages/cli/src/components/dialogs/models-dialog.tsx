import { useCallback, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { DialogSearchList } from "../dialog-search-list";
import type { SupportedChatModel, SupportedChatModelId } from "@koincode/shared";

type Tab = "frontier" | "free";

function isFree(model: SupportedChatModel): boolean {
  return (
    model.pricing.inputUsdPerMillionTokens === 0 &&
    model.pricing.outputUsdPerMillionTokens === 0
  );
}

type ModelsDialogContentProps = {
  models: readonly SupportedChatModel[];
  onSelectModel: (modelId: SupportedChatModelId) => void;
};

export const ModelsDialogContent = ({
  models,
  onSelectModel,
}: ModelsDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();
  const { isTopLayer } = useKeyboardLayer();
  const [activeTab, setActiveTab] = useState<Tab>("frontier");

  const frontierModels = models.filter((m) => !isFree(m)) as SupportedChatModel[];
  const freeModels = models.filter(isFree) as SupportedChatModel[];
  const activeModels = activeTab === "frontier" ? frontierModels : freeModels;

  const handleSelect = useCallback(
    (model: SupportedChatModel) => {
      onSelectModel(model.id);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;
    if (key.name === "tab") {
      setActiveTab((t) => (t === "frontier" ? "free" : "frontier"));
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
      </box>
      <DialogSearchList
        key={activeTab}
        items={activeModels}
        onSelect={handleSelect}
        filterFn={(model, query) => model.id.toLowerCase().includes(query.toLowerCase())}
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
      <text selectable={false} fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
        Tab · switch tabs
      </text>
    </box>
  );
};

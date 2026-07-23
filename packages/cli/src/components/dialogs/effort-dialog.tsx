import { useCallback } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type { ReasoningEffortLevel } from "@koincode/shared";

type EffortDialogContentProps = {
  levels: readonly ReasoningEffortLevel[];
  currentEffort: ReasoningEffortLevel | null;
  onSelectEffort: (effort: ReasoningEffortLevel) => void;
};

const EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

function getEffortLabel(effort: ReasoningEffortLevel): string {
  return EFFORT_LABELS[effort];
}

export const EffortDialogContent = ({
  levels,
  currentEffort,
  onSelectEffort,
}: EffortDialogContentProps) => {
  const dialog = useDialog();

  const handleSelect = useCallback(
    (effort: ReasoningEffortLevel) => {
      onSelectEffort(effort);
      dialog.close();
    },
    [onSelectEffort, dialog],
  );

  return (
    <DialogSearchList
      items={[...levels]}
      onSelect={handleSelect}
      filterFn={(item, query) => getEffortLabel(item).toLowerCase().includes(query.toLowerCase())}
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {item === currentEffort ? " • " : "   "}
          {getEffortLabel(item)}
        </text>
      )}
      getKey={(item) => item}
      placeholder="Search levels"
      emptyText="No matching levels"
    />
  );
};

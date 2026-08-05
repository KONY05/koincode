import { useCallback, useMemo } from "react";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import type { AgentId } from "@koincode/shared";
import { loadPrimaryAgents, type ResolvedAgent } from "../../lib/agents";

type AgentsDialogContentProps = {
  currentMode: AgentId;
  onSelectMode: (mode: AgentId) => void;
};

export const AgentsDialogContent = ({
  currentMode,
  onSelectMode,
}: AgentsDialogContentProps) => {
  const dialog = useDialog();

  const agents = useMemo(() => loadPrimaryAgents(), []);

  const handleSelect = useCallback(
    (agent: ResolvedAgent) => {
      onSelectMode(agent.id);
      dialog.close();
    },
    [onSelectMode, dialog],
  );

  return (
    <DialogSearchList
      items={agents}
      onSelect={handleSelect}
      filterFn={(item, query) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        );
      }}
      renderItem={(item, isSelected) => (
        <box flexDirection="row" flexGrow={1} overflow="hidden">
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {item.id.toLowerCase() === currentMode.toLowerCase() ? " • " : "   "}
            {item.label}
            {item.scope === "builtin" ? "" : ` [${item.scope}]`}
          </text>
        </box>
      )}
      getKey={(item) => item.id}
      placeholder="Search agents"
      emptyText="No matching agents"
    />
  );
};

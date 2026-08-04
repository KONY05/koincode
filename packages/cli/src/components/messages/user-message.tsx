import { agentCanMutate, resolveAgent, type AgentId } from "@koincode/shared";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import { loadAgents } from "../../lib/agents";

type Props = {
  message: string;
  mode: AgentId;
  incognito?: boolean;
};

export function UserMessage({ message, mode, incognito = false }: Props) {
  const { colors } = useTheme();
  const agent = resolveAgent(mode, loadAgents());

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={incognito ? colors.info : agentCanMutate(agent) ? colors.primary : colors.planMode}        width="100%"
        customBorderChars={{
          ...EmptyBorder,
          vertical: incognito ? "┆" : "┃",
          bottomLeft: "╹",
        }}
      >
        <box
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
        >
          <text>{message}</text>
        </box>
      </box>
    </box>
  );
};

import { RGBA, TextAttributes } from "@opentui/core";

import { agentCanMutate, resolveAgent, type AgentId } from "@koincode/shared";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import type { ThemeColors } from "../../providers/theme/theme";
import { loadAgents } from "../../lib/agents";
import { findMentionRanges } from "../../utils/mentions";

type Props = {
  message: string;
  mode: AgentId;
  incognito?: boolean;
};

/** Renders `message` with each `@mention` span wrapped in the selection color same as the
 * input bar highlights while composing (Feature: mention highlighting), so a
 * mention reads the same before and after send. Falls back to the plain string — no
 * `<span>` wrapper — when there's nothing to highlight. */
function renderWithMentionHighlights(message: string, colors: ThemeColors) {
  const ranges = findMentionRanges(message);
  if (ranges.length === 0) return message;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(message.slice(cursor, range.start));
    }
    nodes.push(
      <span key={index} fg={RGBA.fromHex(colors.selection)} attributes={TextAttributes.BOLD}>
        {message.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });

  // Plain text after the last mention (e.g. " please" in "check @foo.ts please") isn't
  // covered by the loop above, which only pushes text *before* each mention — without
  // this, it would be silently dropped instead of rendered.
  if (cursor < message.length) {
    nodes.push(message.slice(cursor));
  }

  return nodes;
}

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
          <text>{renderWithMentionHighlights(message, colors)}</text>
        </box>
      </box>
    </box>
  );
};

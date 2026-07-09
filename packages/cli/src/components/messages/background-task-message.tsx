import { TextAttributes } from "@opentui/core";

import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import { getModelDisplayName } from "../../lib/custom-models";
import type { ChatMessageMetadata } from "@koincode/shared";

const MAX_LINES = 12;
const MAX_LINE_LEN = 120;

function clipLine(line: string): string {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

type Props = {
  view: NonNullable<ChatMessageMetadata["backgroundTaskView"]>;
  model: string;
};

/**
 * Renders a delivered background-task result (spawnAgent runInBackground,
 * backgrounded shell) as a labeled result card — same IN/OUT visual language
 * as ShellView's tool-call box — instead of plain assistant prose, so it
 * reads as structured data the agent is being handed rather than more
 * assistant narration.
 */
export function BackgroundTaskMessage({ view, model }: Props) {
  const { colors } = useTheme();

  const lines = view.output.split("\n").filter(Boolean);
  const visible = lines.slice(0, MAX_LINES);
  const overflow = lines.length - visible.length;

  return (
    <box width="100%" alignItems="center">
      <box width="100%" paddingX={3}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <box flexDirection="row" gap={1}>
            <text fg={colors.info}>Background Task</text>
            <text fg={colors.dimSeparator}>›</text>
            <text>{view.label}</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              (id {view.taskId})
            </text>
          </box>
          <box>
            {view.status === "completed" ? (
              <text fg={colors.success}>✓</text>
            ) : (
              <text fg={colors.error}>✗</text>
            )}
          </box>
        </box>

        <box
          width="100%"
          border={["left"]}
          borderColor={colors.dimSeparator}
          customBorderChars={{ ...EmptyBorder, vertical: "│" }}
          paddingLeft={1}
          marginTop={1}
        >
          {visible.length === 0 ? (
            <box flexDirection="row" gap={1}>
              <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                OUT
              </text>
              <text attributes={TextAttributes.DIM}>(no output)</text>
            </box>
          ) : (
            visible.map((line, i) => (
              <box key={i} flexDirection="row" gap={1}>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  OUT
                </text>
                <text attributes={TextAttributes.DIM} fg={view.status === "error" ? colors.error : undefined}>
                  {clipLine(line)}
                </text>
              </box>
            ))
          )}
          {overflow > 0 && (
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              {"    "}… {overflow} more {overflow === 1 ? "line" : "lines"}
            </text>
          )}
        </box>
      </box>

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text fg={colors.dimSeparator}>◉</text>
          <text attributes={TextAttributes.DIM}>{getModelDisplayName(model)}</text>
        </box>
      </box>
    </box>
  );
}

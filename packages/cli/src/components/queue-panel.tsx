import { TextAttributes } from "@opentui/core";

import type { QueuedMessage } from "../hooks/use-chat";
import { useTheme } from "../providers/theme";


const MAX_PREVIEW = 72;

type Props = {
  queue: QueuedMessage[];
  focusedIndex: number | null;
};

export function QueuePanel({ queue, focusedIndex }: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" flexDirection="column" paddingX={2}>
      {queue.map((item, index) => {
        const isFocused = focusedIndex !== null && index === focusedIndex;
        const raw = item.userText.replace(/\n/g, " ");
        const preview = raw.length > MAX_PREVIEW ? raw.slice(0, MAX_PREVIEW) + "…" : raw;

        return (
          <box
            key={index}
            width="100%"
            backgroundColor={isFocused ? colors.selection : colors.surface}
            paddingX={2}
            paddingY={1}
            flexDirection="row"
            gap={2}
            alignItems="center"
          >
            <text
              selectable={false}
              fg={isFocused ? "black" : colors.dimSeparator}
              attributes={TextAttributes.DIM}
            >
              queue
            </text>
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              <text selectable={false} fg={isFocused ? "black" : undefined}>
                {preview}
              </text>
            </box>
            {isFocused && (
              <text selectable={false} fg="black" attributes={TextAttributes.DIM}>
                ⌫ remove
              </text>
            )}
          </box>
        );
      })}
    </box>
  );
}

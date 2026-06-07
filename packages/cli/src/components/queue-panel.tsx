import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import type { QueuedMessage } from "../hooks/use-chat";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useTheme } from "../providers/theme";


const MAX_PREVIEW = 72;

type Props = {
  queue: QueuedMessage[];
  focusedIndex: number | null;
  onFocusChange: (index: number) => void;
  onRemove: (index: number) => void;
  exitQueueFocus: () => void;
};

export function QueuePanel({ queue, focusedIndex, onFocusChange, onRemove, exitQueueFocus }: Props) {
  const { colors } = useTheme();
  const { isTopLayer } = useKeyboardLayer();
  const inFocusMode = isTopLayer("queue");

  useKeyboard((key) => {
    if (!isTopLayer("queue")) return;

    if (key.name === "up") {
      key.preventDefault();
      if (focusedIndex !== null && focusedIndex > 0) {
        onFocusChange(focusedIndex - 1);
      }
    } else if (key.name === "down") {
      key.preventDefault();
      if (focusedIndex !== null && focusedIndex < queue.length - 1) {
        onFocusChange(focusedIndex + 1);
      } else {
        exitQueueFocus();
      }
    } else if (key.name === "backspace" || key.name === "delete") {
      key.preventDefault();
      if (focusedIndex !== null) {
        onRemove(focusedIndex);
      }
    } else if (key.name === "escape") {
      key.preventDefault();
      exitQueueFocus();
    }
  });

  return (
    <box width="100%" flexDirection="column" paddingX={2}>
      {queue.map((item, index) => {
        const isFocused = inFocusMode && index === focusedIndex;
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

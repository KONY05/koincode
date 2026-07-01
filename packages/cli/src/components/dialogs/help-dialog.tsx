import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../../providers/theme";

// macOS calls the modifier "opt", Windows/Linux terminals call the same key "alt".
const ALT_KEY = process.platform === "darwin" ? "opt" : "alt";

const SHORTCUTS = [
  { key: `${ALT_KEY}+enter`, description: "New line (shift+enter on Kitty terminals)" },
  { key: "↑ / ↓",           description: "Navigate message history" },
  { key: "↑ (empty input)",  description: "Browse queued messages" },
  { key: "@",                description: "Mention a file to add as context" },
  { key: "/",                description: "Open command menu" },
  { key: "tab",              description: "Toggle Plan / Build mode" },
  { key: "ctrl+z",           description: "Undo" },
  // { key: "ctrl+r",           description: "Toggle voice recording (if enabled)" },
  { key: "ctrl+c",           description: "Copy selection, else clear input; press again to exit" },
  { key: "esc",              description: "Interrupt generation" },
  { key: "esc esc",          description: "Delete last message" },
  { key: "ctrl+d",           description: "Delete a highlighted session" },
  { key: "ctrl+u",           description: "Undo session delete" },
];

const KEY_COL_WIDTH = Math.max(...SHORTCUTS.map((s) => s.key.length)) + 4;

export function HelpDialogContent() {
  const { colors } = useTheme();
  const { height: terminalHeight } = useTerminalDimensions();

  // The dialog box itself is height="auto", so it can't cap our height for us —
  // bound the scrollbox to the terminal so overflow scrolls instead of clipping.
  const maxHeight = Math.max(4, terminalHeight - 15);
  const scrollHeight = Math.min(SHORTCUTS.length * 2, maxHeight);

  return (
    <scrollbox height={scrollHeight}>
      {SHORTCUTS.map((shortcut) => (
        <box key={shortcut.key} flexDirection="row" paddingX={1}>
          <box width={KEY_COL_WIDTH} flexShrink={0}>
            <text fg={colors.primary}>{shortcut.key}</text>
          </box>
          <box flexGrow={1}>
            <text attributes={TextAttributes.DIM} wrapMode="word" width="100%">
              {shortcut.description}
            </text>
          </box>
        </box>
      ))}
    </scrollbox>
  );
}

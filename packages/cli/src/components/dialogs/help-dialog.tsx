import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";

const SHORTCUTS = [
  { key: "opt+enter",    description: "New line (shift+enter on Kitty terminals)" },
  { key: "↑ / ↓",       description: "Navigate message history" },
  { key: "tab",          description: "Toggle Plan / Build mode" },
  { key: "ctrl+z",       description: "Undo" },
  { key: "ctrl+c",       description: "Copy selected text" },
  { key: "esc",          description: "Interrupt generation" },
  { key: "esc esc",      description: "Delete last message" },
  { key: "/",            description: "Open command menu" },
];

const KEY_COL_WIDTH = Math.max(...SHORTCUTS.map((s) => s.key.length)) + 4;

export function HelpDialogContent() {
  const { colors } = useTheme();

  return (
    <box flexDirection="column">
      {SHORTCUTS.map((shortcut) => (
        <box key={shortcut.key} flexDirection="row" paddingX={1} height={1}>
          <box width={KEY_COL_WIDTH} flexShrink={0}>
            <text fg={colors.primary}>{shortcut.key}</text>
          </box>
          <box flexGrow={1}>
            <text attributes={TextAttributes.DIM}>{shortcut.description}</text>
          </box>
        </box>
      ))}
    </box>
  );
}

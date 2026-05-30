import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useTheme } from "../../providers/theme";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { EmptyBorder } from "../border";

export type PendingModeSwitch = {
  target: "BUILD";
  reason: string;
};

export type ModeSwitchResponse =
  | { type: "allow-once" }
  | { type: "always-allow" }
  | { type: "deny" };

type Option = {
  response: ModeSwitchResponse;
  label: string;
  shortcut: string;
};

const OPTIONS: Option[] = [
  { response: { type: "allow-once" }, label: "Allow once", shortcut: "1" },
  { response: { type: "always-allow" }, label: "Always allow (set to auto)", shortcut: "2" },
  { response: { type: "deny" }, label: "Deny", shortcut: "3" },
];

type Props = {
  pending: PendingModeSwitch;
  onResponse: (response: ModeSwitchResponse) => void;
};

export function ModeSwitchWidget({ pending, onResponse }: Props) {
  const { colors } = useTheme();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const confirm = (index: number) => {
    const opt = OPTIONS[index];
    if (opt) onResponse(opt.response);
  };

  useEffect(() => {
    push("mode-switch", () => {
      onResponse({ type: "deny" });
      return true;
    });
    return () => pop("mode-switch");
  }, [onResponse, pop, push]);

  useKeyboard((key) => {
    if (!isTopLayer("mode-switch")) return;

    if (key.name === "escape") {
      key.preventDefault();
      onResponse({ type: "deny" });
    } else if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((i) => Math.min(OPTIONS.length - 1, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      confirm(selectedIndex);
    } else if (key.sequence === "1") {
      key.preventDefault();
      confirm(0);
    } else if (key.sequence === "2") {
      key.preventDefault();
      confirm(1);
    } else if (key.sequence === "3") {
      key.preventDefault();
      confirm(2);
    }
  });

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={colors.primary}
        customBorderChars={{
          ...EmptyBorder,
          vertical: "┃",
          bottomLeft: "╹",
        }}
        width="100%"
      >
        <box
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
          gap={1}
        >
          <box flexDirection="row" gap={2} alignItems="center">
            <text fg={colors.primary} attributes={TextAttributes.BOLD}>
              ⚡ Switch to BUILD mode?
            </text>
          </box>

          <box>
            <text fg="gray">{pending.reason}</text>
          </box>

          <box gap={0}>
            {OPTIONS.map((opt, i) => {
              const isSelected = i === selectedIndex;
              const isDeny = opt.response.type === "deny";
              const fg = isSelected
                ? isDeny
                  ? colors.error
                  : colors.primary
                : colors.dimSeparator;

              return (
                <box
                  key={opt.response.type}
                  flexDirection="row"
                  gap={1}
                  height={1}
                  onMouseMove={() => setSelectedIndex(i)}
                  onMouseDown={() => confirm(i)}
                >
                  <text
                    fg={fg}
                    attributes={isSelected ? TextAttributes.BOLD : undefined}
                  >
                    {isSelected ? "›" : " "} [{opt.shortcut}]
                  </text>
                  <text
                    fg={isSelected ? (isDeny ? colors.error : "white") : "gray"}
                  >
                    {opt.label}
                  </text>
                </box>
              );
            })}
          </box>
        </box>
      </box>
    </box>
  );
}

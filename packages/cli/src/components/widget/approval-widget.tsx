import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useTheme } from "../../providers/theme";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { EmptyBorder } from "../border";
import type {
  ApprovalResponse,
  PendingApproval,
} from "../../utils/permissions";

type Option = {
  response: ApprovalResponse;
  label: string;
  shortcut: string;
};

const STANDARD_OPTIONS: Option[] = [
  { response: { type: "allow-once" }, label: "Allow once", shortcut: "1" },
  { response: { type: "allow-for-project" }, label: "Allow for project", shortcut: "2" },
  { response: { type: "deny" }, label: "Deny", shortcut: "3" },
];

const MCP_OPTIONS: Option[] = [
  { response: { type: "allow-once" }, label: "Allow once", shortcut: "1" },
  { response: { type: "allow-for-session" }, label: "Allow for session", shortcut: "2" },
  { response: { type: "deny" }, label: "Deny", shortcut: "3" },
];

type Props = {
  approval: PendingApproval;
  onResponse: (response: ApprovalResponse) => void;
};

export function ApprovalWidget({ approval, onResponse }: Props) {
  const { colors } = useTheme();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const OPTIONS = approval.sessionOnly ? MCP_OPTIONS : STANDARD_OPTIONS;
  const borderColor =
    approval.tier === "destructive" ? colors.error : colors.primary;
  const icon = approval.tier === "destructive" ? "!" : "?";

  const confirm = (index: number) => {
    const opt = OPTIONS[index];
    if (opt) onResponse(opt.response);
  };

  useEffect(() => {
    push("approval", () => {
      onResponse({ type: "deny" });
      return true;
    });
    return () => pop("approval");
  }, [onResponse, pop, push]);

  useKeyboard((key) => {
    if (!isTopLayer("approval")) return;

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
        borderColor={borderColor}
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
          {/* Header: icon + label + permission key */}
          <box flexDirection="row" gap={2} alignItems="center">
            <text fg={borderColor} attributes={TextAttributes.BOLD}>
              {icon} {approval.label}
            </text>
            <text fg={colors.dimSeparator}>{approval.key}</text>
          </box>

          {/* Command / path being requested */}
          <box>
            <text fg="gray">$ {approval.description}</text>
          </box>

          {/* Option list */}
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

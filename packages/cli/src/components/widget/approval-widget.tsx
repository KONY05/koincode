import { useEffect, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

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

function resetNestedTextScroll(node: unknown): void {
  const candidate = node as {
    wrapMode?: unknown;
    scrollX?: number;
    scrollY?: number;
    getChildren?: () => unknown[];
  };

  if (typeof candidate.wrapMode === "string") {
    if (candidate.scrollY) candidate.scrollY = 0;
    if (candidate.scrollX) candidate.scrollX = 0;
  }

  if (typeof candidate.getChildren === "function") {
    for (const child of candidate.getChildren()) resetNestedTextScroll(child);
  }
}

type Props = {
  approval: PendingApproval;
  onResponse: (response: ApprovalResponse) => void;
};

export function ApprovalWidget({ approval, onResponse }: Props) {
  const { colors } = useTheme();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { height: terminalHeight, width: terminalWidth } = useTerminalDimensions();

  const OPTIONS = approval.sessionOnly ? MCP_OPTIONS : STANDARD_OPTIONS;
  const borderColor =
    approval.tier === "destructive" ? colors.error : colors.primary;
  const icon = approval.tier === "destructive" ? "!" : "?";

  const safeTerminalHeight = terminalHeight || 24;
  const safeTerminalWidth = terminalWidth || 80;
  const overhead = 12 + (approval.summary ? 2 : 0);
  const maxHeight = Math.min(15, Math.max(3, safeTerminalHeight - overhead));

  const rawLines = approval.description.split("\n");
  const usableWidth = Math.max(20, safeTerminalWidth - 10);
  let contentLines = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? "";
    const len = (i === 0 ? 2 : 0) + line.length;
    contentLines += Math.max(1, Math.ceil(len / usableWidth));
  }
  const isScrollable = contentLines > maxHeight;
  const scrollHeight = Math.min(contentLines, maxHeight);

  const confirm = (index: number) => {
    const opt = OPTIONS[index];
    if (opt) onResponse(opt.response);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo(0);
  }, [approval]);

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
    } else if (key.shift && key.name === "up") {
      key.preventDefault();
      scrollRef.current?.scrollBy(-2);
    } else if (key.shift && key.name === "down") {
      key.preventDefault();
      scrollRef.current?.scrollBy(2);
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
            {isScrollable && (
              <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
                · pgup/pgdn to scroll
              </text>
            )}
          </box>

          {/* Model-authored summary of what the command does */}
          {approval.summary && (
            <box>
              <text fg={colors.dimSeparator}>{approval.summary}</text>
            </box>
          )}

          {/* Command / path being requested */}
          <scrollbox
            ref={scrollRef}
            height={scrollHeight}
            width="100%"
            flexShrink={0}
            onMouseScroll={() => resetNestedTextScroll(scrollRef.current)}
          >
            <text fg="gray" wrapMode="word">$ {approval.description}</text>
          </scrollbox>

          {/* Option list */}
          <box gap={0} flexShrink={0}>
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

import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useTheme } from "../../providers/theme";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { EmptyBorder } from "../border";
import type { FileRevertPlan } from "../../lib/revert-mutations";

export type PendingRevertConfirm = {
  plans: FileRevertPlan[];
};

type Option = {
  confirmed: boolean;
  label: string;
  shortcut: string;
};

type Props = {
  pending: PendingRevertConfirm;
  onResponse: (confirmed: boolean) => void;
};

export function RevertConfirmWidget({ pending, onResponse }: Props) {
  const { colors } = useTheme();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const revertible = pending.plans.filter((p) => p.kind !== "conflict");
  const conflicts = pending.plans.filter((p) => p.kind === "conflict");

  // The confirm option only ever deletes the turn — reverting files is a
  // side effect that may be partial or absent, so the label has to say so
  // rather than always claiming "revert files".
  const confirmLabel =
    revertible.length === 0
      ? "Delete turn (no files reverted)"
      : conflicts.length > 0
        ? "Delete turn (partially revert files)"
        : "Delete turn (revert files)";

  const OPTIONS: Option[] = [
    { confirmed: false, label: "Cancel", shortcut: "1" },
    { confirmed: true, label: confirmLabel, shortcut: "2" },
  ];

  const confirm = (index: number) => {
    const opt = OPTIONS[index];
    if (opt) onResponse(opt.confirmed);
  };

  useEffect(() => {
    push("revert-confirm", () => {
      onResponse(false);
      return true;
    });
    return () => pop("revert-confirm");
  }, [onResponse, pop, push]);

  useKeyboard((key) => {
    if (!isTopLayer("revert-confirm")) return;

    if (key.name === "escape") {
      key.preventDefault();
      onResponse(false);
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
              ⚡ Delete this turn?
            </text>
          </box>

          {revertible.length > 0 && (
            <box>
              <text fg="gray">
                This will revert file changes to:{" "}
                {revertible.map((p) => p.path).join(", ")}
              </text>
            </box>
          )}

          {conflicts.length > 0 && (
            <box>
              <text fg={colors.error}>
                {conflicts
                  .map((p) => `${p.path} — ${p.reason} — its changes will NOT be reverted`)
                  .join("; ")}
              </text>
            </box>
          )}

          <box gap={0}>
            {OPTIONS.map((opt, i) => {
              const isSelected = i === selectedIndex;
              const isConfirm = opt.confirmed;
              const fg = isSelected
                ? isConfirm
                  ? colors.error
                  : colors.primary
                : colors.dimSeparator;

              return (
                <box
                  key={opt.label}
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
                    fg={isSelected ? (isConfirm ? colors.error : "white") : "gray"}
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

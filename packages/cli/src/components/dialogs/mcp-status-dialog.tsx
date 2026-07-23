import { useCallback, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";
import { useMcpServers, setMcpServerEnabled, type McpServerStatus } from "../../hooks/use-mcp-servers";

function statusLabel(status: string): string {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Disabled";
}

export function McpStatusDialogContent() {
  const { colors } = useTheme();
  const toast = useToast();
  const { isTopLayer } = useKeyboardLayer();
  const servers = useMcpServers({ includeDisabled: true });
  const [overrides, setOverrides] = useState<Record<string, McpServerStatus>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pending, setPending] = useState<string | null>(null);

  const rows = servers.map((s) => overrides[s.name] ?? s);

  const toggleSelected = useCallback(async () => {
    const row = rows[selectedIndex];
    if (!row || pending) return;

    const nextEnabled = row.status === "disconnected";
    setPending(row.name);
    try {
      const updated = await setMcpServerEnabled(row.name, nextEnabled);
      setOverrides((prev) => ({ ...prev, [updated.name]: updated }));
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to update MCP server",
      });
    } finally {
      setPending(null);
    }
  }, [rows, selectedIndex, pending, toast]);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      setSelectedIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      void toggleSelected();
    }
  });

  if (rows.length === 0) {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text attributes={TextAttributes.DIM}>No MCP servers configured.</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" gap={0} paddingX={1} paddingY={1}>
      {rows.map((s, i) => {
        const isSelected = i === selectedIndex;
        const dotColor =
          s.status === "connected"
            ? colors.success
            : s.status === "error"
              ? colors.error
              : colors.dimSeparator;

        return (
          <box key={s.name} flexDirection="column">
            <box
              flexDirection="row"
              gap={1}
              height={1}
              backgroundColor={isSelected ? colors.selection : undefined}
              onMouseDown={() => setSelectedIndex(i)}
            >
              <text fg={isSelected ? "black" : dotColor}>•</text>
              <box width={20} flexShrink={0}>
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                  {s.name}
                </text>
              </box>
              <box width={9} flexShrink={0}>
                <text
                  selectable={false}
                  fg={isSelected ? "black" : colors.dimSeparator}
                  attributes={TextAttributes.DIM}
                >
                  [{s.source}]
                </text>
              </box>
              <box width={10} flexShrink={0}>
                <text selectable={false} fg={isSelected ? "black" : dotColor}>
                  {pending === s.name ? "Updating…" : statusLabel(s.status)}
                </text>
              </box>
              <text
                selectable={false}
                fg={isSelected ? "black" : colors.dimSeparator}
                attributes={TextAttributes.DIM}
              >
                {s.status === "connected"
                  ? `${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`
                  : ""}
              </text>
            </box>
            {s.error ? (
              <box paddingLeft={2}>
                <text fg={colors.error} attributes={TextAttributes.DIM}>
                  {s.error}
                </text>
              </box>
            ) : null}
          </box>
        );
      })}
      <box marginTop={1}>
        <text attributes={TextAttributes.DIM}>
          ↑↓ navigate · enter to {rows[selectedIndex]?.status === "disconnected" ? "enable" : "disable"}
        </text>
      </box>
    </box>
  );
}

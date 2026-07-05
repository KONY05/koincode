import { useState } from "react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../providers/theme";
import type { ContextUsage } from "../hooks/use-chat";
import { useMcpServers } from "../hooks/use-mcp-servers";
import { useModifiedFiles } from "../hooks/use-modified-files";

const SIDEBAR_WIDTH = 34;

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <text attributes={TextAttributes.BOLD} fg={colors.dimSeparator}>
      {children}
    </text>
  );
}

type Props = {
  sessionTitle?: string;
  contextUsage?: ContextUsage | null;
  sessionCost: number;
  visible: boolean;
};

export function InfoSidebar({ sessionTitle, contextUsage, sessionCost, visible }: Props) {
  const { colors } = useTheme();
  const mcpServers = useMcpServers();
  const modifiedFiles = useModifiedFiles(visible);
  const [filesExpanded, setFilesExpanded] = useState(true);

  if (!visible) return null;

  return (
    <box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      height="100%"
      flexShrink={0}
      backgroundColor={colors.surface}
      paddingX={1}
      paddingY={1}
      gap={1}
    >
      {sessionTitle && (
        <text attributes={TextAttributes.BOLD} wrapMode="word">
          {sessionTitle}
        </text>
      )}

      <box flexDirection="column" flexShrink={0}>
        <SectionLabel>Context</SectionLabel>
        {contextUsage?.hasUsageData ? (
          <>
            <text>{formatNumber(contextUsage.tokensUsed)} tokens</text>
            <text>{contextUsage.percent}% used</text>
            <text>≈ ${sessionCost.toFixed(2)} spent</text>
          </>
        ) : (
          <text attributes={TextAttributes.DIM}>No usage yet</text>
        )}
      </box>

      <box flexDirection="column" flexShrink={0}>
        <SectionLabel>MCP</SectionLabel>
        {mcpServers.length === 0 ? (
          <text attributes={TextAttributes.DIM}>No servers configured</text>
        ) : (
          mcpServers.map((s) => (
            <box key={s.name} flexDirection="row" gap={1}>
              <text fg={s.status === "connected" ? colors.success : colors.error}>
                •
              </text>
              <text attributes={TextAttributes.DIM}>
                {s.name} {s.status === "connected" ? "Connected" : "Error"}
              </text>
            </box>
          ))
        )}
      </box>

      <box
        flexDirection="row"
        gap={1}
        height={1}
        flexShrink={0}
        onMouseDown={() => setFilesExpanded((v) => !v)}
      >
        <SectionLabel>Modified Files</SectionLabel>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          {filesExpanded ? "▾" : "▸"}
        </text>
      </box>
      {filesExpanded && (
        modifiedFiles.length === 0 ? (
          <text attributes={TextAttributes.DIM}>No changes</text>
        ) : (
          <scrollbox flexGrow={1} width="100%">
            <box flexDirection="column" width="100%">
              {modifiedFiles.map((f) => (
                <box key={f.path} flexDirection="row" justifyContent="space-between" gap={1}>
                  <text attributes={TextAttributes.DIM} wrapMode="none">
                    {f.path}
                  </text>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    {f.added > 0 && <text fg={colors.success}>+{f.added}</text>}
                    {f.removed > 0 && <text fg={colors.error}>-{f.removed}</text>}
                  </box>
                </box>
              ))}
            </box>
          </scrollbox>
        )
      )}
    </box>
  );
}

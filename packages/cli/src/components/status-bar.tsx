import { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { useUpdateCheck } from "../hooks/use-update-check";
import { useIdeContext } from "../hooks/use-ide-context";
import { Mode } from "@koincode/shared";
import type { ContextUsage } from "../hooks/use-chat";
import { apiClient } from "../lib/api-client";

const RING_SEGMENTS = 10;
const RING_THRESHOLD = 80; // from what context percent to show the ring

function buildRing(percent: number): string {
  const filled = Math.min(RING_SEGMENTS, Math.floor(percent / RING_SEGMENTS));
  return "●".repeat(filled) + "○".repeat(RING_SEGMENTS - filled);
}

function useMcpServerCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await apiClient.mcp.servers.$get();
        if (!res.ok) return;
        const servers = await res.json();
        setCount(servers.filter((s) => s.status === "connected").length);
      } catch {
        // non-fatal
      }
    };
    void fetch();
  }, []);

  return count;
}

type Props = {
  contextUsage?: ContextUsage | null;
};

export function StatusBar({ contextUsage }: Props) {
  const { mode, modelDisplayName, voiceInput } = usePromptConfig();
  const { colors } = useTheme();
  const updateInfo = useUpdateCheck();
  const { activeFile, fileContextEnabled, toggleFileContext } = useIdeContext();
  const mcpServerCount = useMcpServerCount();

  const showRing = contextUsage !== null && contextUsage !== undefined && contextUsage.percent >= RING_THRESHOLD;
  const ringColor = contextUsage && contextUsage.percent >= 95 ? "red" : "yellow";

  return (
    <box flexDirection="row" gap={1} width="100%" justifyContent="space-between">
      <box flexDirection="row" gap={1}>
        <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
          {mode === Mode.PLAN ? "Plan" : "Build"}
        </text>

        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          ›
        </text>
        <text>{modelDisplayName}</text>

        {voiceInput && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text fg={colors.primary}>voice</text>
          </>
        )}

        {mcpServerCount > 0 && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text attributes={TextAttributes.DIM} fg={colors.info}>
              {mcpServerCount} mcp
            </text>
          </>
        )}

        {updateInfo.status !== "current" && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text fg={colors.primary}>
              {updateInfo.status === "downloaded"
                ? "restart for update"
                : "update available · /update"}
            </text>
          </>
        )}
      </box>

      <box flexDirection="row" gap={2}>
        {showRing && (
          <text fg={ringColor}>
            {buildRing(contextUsage!.percent)} {contextUsage!.percent}%
          </text>
        )}
        {activeFile && (
          <text
            attributes={fileContextEnabled
              ? TextAttributes.DIM
              : TextAttributes.DIM | TextAttributes.STRIKETHROUGH}
            onMouseDown={toggleFileContext}
          >
            In {activeFile}
          </text>
        )}
      </box>
    </box>
  );
}

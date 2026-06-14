import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { useUpdateCheck } from "../hooks/use-update-check";
import { Mode } from "@koincode/shared";
import type { ContextUsage } from "../hooks/use-chat";

const RING_SEGMENTS = 10;
const RING_THRESHOLD = 80; // from what context percent to show the ring

function buildRing(percent: number): string {
  const filled = Math.min(RING_SEGMENTS, Math.floor(percent / RING_SEGMENTS));
  return "●".repeat(filled) + "○".repeat(RING_SEGMENTS - filled);
}

type Props = {
  contextUsage?: ContextUsage | null;
  mcpServerCount?: number;
};

export function StatusBar({ contextUsage, mcpServerCount }: Props) {
  const { mode, model, voiceInput } = usePromptConfig();
  const { colors } = useTheme();
  const hasUpdate = useUpdateCheck();

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
        <text>{model}</text>

        {voiceInput && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text fg={colors.primary}>voice</text>
          </>
        )}

        {mcpServerCount != null && mcpServerCount > 0 && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text attributes={TextAttributes.DIM} fg={colors.info}>
              {mcpServerCount} mcp
            </text>
          </>
        )}

        {hasUpdate && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text fg={colors.primary}>update available · /update</text>
          </>
        )}
      </box>

      {showRing && (
        <text fg={ringColor}>
          {buildRing(contextUsage!.percent)} {contextUsage!.percent}%
        </text>
      )}
    </box>
  );
}

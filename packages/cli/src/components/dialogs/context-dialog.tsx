import { TextAttributes } from "@opentui/core";

import type { ContextUsage } from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";

type Props = {
  contextUsage: ContextUsage | null;
  model: string;
};

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function renderBar(percent: number, width = 30): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function ContextDialogContent({ contextUsage, model }: Props) {
  const { colors } = useTheme();

  if (!contextUsage) {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text fg={colors.primary}>{model}</text>
        <text attributes={TextAttributes.DIM}>
          No messages sent yet — context usage will appear after the first response.
        </text>
      </box>
    );
  }

  if (!contextUsage.hasUsageData) {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text fg={colors.primary}>{model}</text>
        <text attributes={TextAttributes.DIM}>
          This model does not report token usage.
        </text>
      </box>
    );
  }

  const { tokensUsed, contextWindow, percent } = contextUsage;
  const freeTokens = contextWindow - tokensUsed;
  const contextWindowK = contextWindow >= 1_000_000
    ? `${(contextWindow / 1_000_000).toFixed(1)}M`
    : `${Math.round(contextWindow / 1_000)}k`;

  const barColor =
    percent >= 95 ? "red" : percent >= 80 ? "yellow" : colors.primary;

  return (
    <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      <box flexDirection="row" gap={2}>
        <text fg={colors.primary}>{model}</text>
        <text attributes={TextAttributes.DIM}>{contextWindowK} context window</text>
      </box>

      <box flexDirection="row" gap={1}>
        <text attributes={TextAttributes.DIM}>Used:</text>
        <text>
          {formatNumber(tokensUsed)} / {formatNumber(contextWindow)}
        </text>
        <text fg={barColor}>({percent}%)</text>
      </box>

      <text fg={barColor}>{renderBar(percent)}</text>

      <box flexDirection="row" gap={1}>
        <text attributes={TextAttributes.DIM}>Free space:</text>
        <text>{formatNumber(freeTokens)} tokens</text>
      </box>
    </box>
  );
}

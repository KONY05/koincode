import { useTerminalDimensions } from "@opentui/react";

import { useTheme } from "../../providers/theme";

type Props = {
  text: string;
};

export function SystemMessage({ text }: Props) {
  const { width } = useTerminalDimensions();
  const { colors } = useTheme();

 const content = ` ${text} `;
  const halfWidth = Math.max(0, Math.floor(width / 4) - Math.ceil(content.length / 2));
  const leftDashes = halfWidth;
  const rightDashes = Math.max(0, Math.floor(width / 2) - content.length - leftDashes - 1);

  return (
    <box flexDirection="row" width="100%" paddingY={1}>
      <text fg={colors.dimSeparator}>
        {"─".repeat(leftDashes)}{content}
        {"─".repeat(rightDashes)}
      </text>
    </box>
  );
}

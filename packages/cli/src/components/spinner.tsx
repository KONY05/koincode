import { TextAttributes } from "@opentui/core";
import "opentui-spinner/react";

type Props = {
  activeColor: string;
  showLabel?: boolean;
};

export function Spinner({ activeColor, showLabel = true }: Props) {
  return (
  <box flexDirection="row" alignItems="center" gap={1}>
    <spinner name="star" color={activeColor} />
    {showLabel && (
      <text attributes={TextAttributes.DIM}><em>koincoding</em>...</text>
    )}
  </box>
)};

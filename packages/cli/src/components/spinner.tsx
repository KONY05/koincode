import { TextAttributes } from "@opentui/core";
import "opentui-spinner/react";

type Props = {
  activeColor: string;
};

export function Spinner({ activeColor }: Props) {
  return (
  <box flexDirection="row" alignItems="center" gap={1}>
    <spinner name="star" color={activeColor} />
    <text attributes={TextAttributes.DIM}><em>koincoding</em>...</text>
  </box>
)};

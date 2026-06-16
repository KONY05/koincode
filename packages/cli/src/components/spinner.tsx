import { TextAttributes } from "@opentui/core";
import "opentui-spinner/react";

type Props = {
  activeColor: string;
  text?: string;
};

export function Spinner({ activeColor, text }: Props) {
  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <spinner name="star" color={activeColor} />
      <text attributes={TextAttributes.DIM}>
        <em>{text ? text : "koincoding"}</em>...
      </text>
    </box>
  );
}

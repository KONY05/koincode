import { TextAttributes } from "@opentui/core";
import "opentui-spinner/react";

type Props = {
  activeColor: string;
  showLabel?: boolean;
  text?: string;
};

export function Spinner({ activeColor, showLabel = true, text }: Props) {
  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <spinner name="star" color={activeColor} />
      {showLabel && (
        <text attributes={TextAttributes.DIM}>
          <em>{text ? text : "koincoding"}</em>...
        </text>
      )}
    </box>
  );
}

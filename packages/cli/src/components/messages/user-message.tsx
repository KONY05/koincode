import { Mode, type ModeType } from "@koincode/shared";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";

type Props = {
  message: string;
  mode: ModeType;
  incognito?: boolean;
};

export function UserMessage({ message, mode, incognito = false }: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={incognito ? colors.info : mode === Mode.PLAN ? colors.planMode : colors.primary}        width="100%"
        customBorderChars={{
          ...EmptyBorder,
          vertical: incognito ? "┆" : "┃",
          bottomLeft: "╹",
        }}
      >
        <box
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
        >
          <text>{message}</text>
        </box>
      </box>
    </box>
  );
};

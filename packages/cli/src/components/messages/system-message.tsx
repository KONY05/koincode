import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";

type Props = {
  text: string;
};

export function SystemMessage({ text }: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" paddingY={1}>
      <box
        width="100%"
        border={["top"]}
        borderColor={colors.dimSeparator}
        customBorderChars={{ ...EmptyBorder, horizontal: "─" }}
        title={` ${text} `}
        titleAlignment="center"
        titleColor={colors.dimSeparator}
      />
    </box>
  );
}

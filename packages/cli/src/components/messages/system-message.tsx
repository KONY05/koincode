import { useTheme } from "../../providers/theme";

type Props = {
  text: string;
};

export function SystemMessage({ text }: Props) {
  const { colors } = useTheme();

  return (
    <box flexDirection="row" alignItems="center" gap={1} paddingY={1}>
      <text fg={colors.dimSeparator}>── {text} ──</text>
    </box>
  );
}

import { TextAttributes } from "@opentui/core";

import { Spinner } from "../spinner";
import type { ThemeColors } from "../../providers/theme/theme";

const MAX_LINES = 15;
const MAX_LINE_LEN = 120;

function clipLine(line: string): string {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

export default function ShellView({
  input,
  output,
  pending,
  error,
  colors,
}: {
  input: unknown;
  output?: unknown;
  pending: boolean;
  error?: string;
  colors: ThemeColors;
}) {
  if (!input || typeof input !== "object") return null;
  const { command } = input as { command?: string };
  if (typeof command !== "string") return null;

  const result =
    output && typeof output === "object"
      ? (output as { stdout?: string; stderr?: string; exitCode?: number })
      : null;

  const stdoutLines = result?.stdout?.split("\n").filter(Boolean) ?? [];
  const stderrLines = result?.stderr?.split("\n").filter(Boolean) ?? [];
  const allLines = [...stdoutLines, ...stderrLines];
  const visibleLines = allLines.slice(0, MAX_LINES);
  const overflow = allLines.length - MAX_LINES;
  const failed =
    typeof result?.exitCode === "number" && result.exitCode !== 0;

  return (
    <box width="100%">
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={colors.info}>$</text>
        <text>{command}</text>
        {pending && <Spinner activeColor={colors.info} />}
      </box>

      {visibleLines.length > 0 && (
        <box width="100%" paddingLeft={2} paddingTop={1}>
          {visibleLines.map((line, i) => (
            <text key={i} attributes={TextAttributes.DIM}>
              {clipLine(line)}
            </text>
          ))}
          {overflow > 0 && (
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              … {overflow} more {overflow === 1 ? "line" : "lines"}
            </text>
          )}
        </box>
      )}

      {failed && (
        <text fg={colors.error} paddingLeft={2}>
          exit {result!.exitCode}
        </text>
      )}
      {!!error && <text fg={colors.error}>{error}</text>}
    </box>
  );
}

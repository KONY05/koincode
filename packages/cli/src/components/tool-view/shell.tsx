import { TextAttributes } from "@opentui/core";

import { Spinner } from "../spinner";
import { EmptyBorder } from "../border";
import type { ThemeColors } from "../../providers/theme/theme";

const MAX_LINES = 12;
const MAX_LINE_LEN = 120;

function clipLine(line: string): string {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

function OutputBlock({
  lines,
  overflow,
  borderColor,
  fg,
  colors,
}: {
  lines: string[];
  overflow: number;
  borderColor: string;
  fg?: string;
  colors: ThemeColors;
}) {
  if (lines.length === 0) return null;
  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={borderColor}
      customBorderChars={{ ...EmptyBorder, vertical: "│" }}
      paddingLeft={1}
      marginTop={1}
    >
      {lines.map((line, i) => (
        <text key={i} attributes={TextAttributes.DIM} fg={fg}>
          {clipLine(line)}
        </text>
      ))}
      {overflow > 0 && (
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          … {overflow} more {overflow === 1 ? "line" : "lines"}
        </text>
      )}
    </box>
  );
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
      ? (output as { stdout?: string; stderr?: string; exitCode?: number; pid?: number })
      : null;

  const isBackground = !pending && result !== null && typeof result.pid === "number" && typeof result.exitCode !== "number";

  const stdoutLines = result?.stdout?.split("\n").filter(Boolean) ?? [];
  const stderrLines = result?.stderr?.split("\n").filter(Boolean) ?? [];

  const stdoutVisible = stdoutLines.slice(0, MAX_LINES);
  const stdoutOverflow = stdoutLines.length - stdoutVisible.length;

  const stderrVisible = stderrLines.slice(0, MAX_LINES);
  const stderrOverflow = stderrLines.length - stderrVisible.length;

  const failed = typeof result?.exitCode === "number" && result.exitCode !== 0;
  const done = !pending && result !== null;

  return (
    <box width="100%">
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          <text fg={colors.info}>❯</text>
          <text>{command}</text>
          {isBackground && (
            <text attributes={TextAttributes.DIM} fg={colors.info}>
              pid {result!.pid} {" "}
            </text>
          )}
        </box>
        <box>
          {pending ? (
            <Spinner activeColor={colors.info} />
          ) : isBackground ? (
            <Spinner activeColor={colors.info} text="Running in background" />
          ) : done && failed ? (
            <text fg={colors.error}>✗ {result!.exitCode}</text>
          ) : done ? (
            <text fg={colors.success}>✓</text>
          ) : null}
        </box>
      </box>

      <OutputBlock
        lines={stdoutVisible}
        overflow={stdoutOverflow}
        borderColor={colors.dimSeparator}
        colors={colors}
      />

      <OutputBlock
        lines={stderrVisible}
        overflow={stderrOverflow}
        borderColor={colors.error}
        fg={colors.error}
        colors={colors}
      />

      {!!error && (
        <text fg={colors.error} paddingLeft={2}>
          {error}
        </text>
      )}
    </box>
  );
}

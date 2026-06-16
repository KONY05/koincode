import { TextAttributes } from "@opentui/core";

import { Spinner } from "../spinner";
import { EmptyBorder } from "../border";
import type { ThemeColors } from "../../providers/theme/theme";

const MAX_LINES = 12;
const MAX_LINE_LEN = 120;

function clipLine(line: string): string {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

function LabeledLine({
  label,
  text,
  fg,
  colors,
}: {
  label: string;
  text: string;
  fg?: string;
  colors: ThemeColors;
}) {
  return (
    <box flexDirection="row" gap={1}>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        {label}
      </text>
      <text attributes={TextAttributes.DIM} fg={fg}>
        {text}
      </text>
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
  const { command, description } = input as {
    command?: string;
    description?: string;
  };
  if (typeof command !== "string") return null;

  const result =
    output && typeof output === "object"
      ? (output as {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          pid?: number;
        })
      : null;

  const isBackground =
    !pending &&
    result !== null &&
    typeof result.pid === "number" &&
    typeof result.exitCode !== "number";

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
          <text fg={colors.info}>Shell</text>
          {description && (
            <>
              <text fg={colors.dimSeparator}>›</text>
              <text>{description}</text>
            </>
          )}
        </box>
        <box>
          {pending ? (
            <Spinner activeColor={colors.info} text="pending" />
          ) : isBackground ? (
            <Spinner
              activeColor={colors.info}
              text={`pid ${result!.pid} `}
            />
          ) : done && failed ? (
            <text fg={colors.error}>✗ {result!.exitCode}</text>
          ) : done ? (
            <text fg={colors.success}>✓</text>
          ) : null}
        </box>
      </box>

      <box
        width="100%"
        border={["left"]}
        borderColor={colors.dimSeparator}
        customBorderChars={{ ...EmptyBorder, vertical: "│" }}
        paddingLeft={1}
        marginTop={1}
      >
        <LabeledLine label="IN " text={command} colors={colors} />

        {stdoutVisible.map((line, i) => (
          <LabeledLine
            key={i}
            label="OUT"
            text={clipLine(line)}
            colors={colors}
          />
        ))}
        {stdoutOverflow > 0 && (
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            {"    "}… {stdoutOverflow} more{" "}
            {stdoutOverflow === 1 ? "line" : "lines"}
          </text>
        )}

        {stderrVisible.map((line, i) => (
          <LabeledLine
            key={`e${i}`}
            label="ERR"
            text={clipLine(line)}
            fg={colors.error}
            colors={colors}
          />
        ))}
        {stderrOverflow > 0 && (
          <text attributes={TextAttributes.DIM} fg={colors.error}>
            {"    "}… {stderrOverflow} more{" "}
            {stderrOverflow === 1 ? "line" : "lines"}
          </text>
        )}
      </box>

      {!!error && (
        <text fg={colors.error} paddingLeft={2}>
          {error}
        </text>
      )}
    </box>
  );
}

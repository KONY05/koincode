import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";

import { Spinner } from "../spinner";
import { EmptyBorder } from "../border";
import type { ThemeColors } from "../../providers/theme/theme";
import {
  onProcessExited,
  type ProcessStatusOrUnknown,
} from "../../lib/background/background-process-status";

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
  // Hooks must run unconditionally on every render — computed here, ahead of
  // the input-validity early returns below.
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

  const backgroundPid = isBackground ? (result!.pid as number) : null;

  // The background-mode tool result is fixed at spawn time (just the PID) and
  // never updates — this is the side channel that tells us once the process
  // has actually exited, so the spinner doesn't run forever.
  //
  // Defaults to "still running, tracked" — the right assumption for the
  // common case (backgroundPid is null at mount, since this component first
  // renders while the tool call is still pending, before the PID exists; a
  // lazy initializer keyed on backgroundPid would freeze in whatever it saw
  // at that first render and never reconsider once the real PID shows up on
  // a later render, which is exactly the bug this used to have). The effect
  // below is a pure subscribe — onProcessExited itself determines and
  // reports the true status (including "unknown", for a PID that predates
  // this process) asynchronously via its callback, never synchronously in
  // the effect body.
  const [exitedStatus, setExitedStatus] = useState<ProcessStatusOrUnknown>({
    exited: false,
  });

  useEffect(() => {
    if (backgroundPid == null) return;
    return onProcessExited(backgroundPid, (status) => setExitedStatus(status));
  }, [backgroundPid]);

  if (!input || typeof input !== "object") return null;
  const { command, description } = input as {
    command?: string;
    description?: string;
  };
  if (typeof command !== "string") return null;

  const stdoutLines = result?.stdout?.split("\n").filter(Boolean) ?? [];
  const stderrLines = result?.stderr?.split("\n").filter(Boolean) ?? [];

  const stdoutVisible = stdoutLines.slice(0, MAX_LINES);
  const stdoutOverflow = stdoutLines.length - stdoutVisible.length;

  const stderrVisible = stderrLines.slice(0, MAX_LINES);
  const stderrOverflow = stderrLines.length - stderrVisible.length;

  const done = !pending && result !== null;
  const backgroundFinished =
    isBackground && exitedStatus !== "unknown" && exitedStatus.exited;
  const backgroundUnknown = isBackground && exitedStatus === "unknown";
  const backgroundExitCode =
    exitedStatus !== "unknown" ? exitedStatus.exitCode : undefined;

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
          ) : backgroundFinished ? (
            <text fg={colors.success}>
              ✓ (background
              {typeof backgroundExitCode === "number"
                ? `, exit ${backgroundExitCode}`
                : ""}
              )
            </text>
          ) : backgroundUnknown ? (
            <text fg={colors.dimSeparator}>⏸ background</text>
          ) : isBackground ? (
            <Spinner activeColor={colors.info} text={`pid ${result!.pid} `} />
          ) : error ? (
            <text fg={colors.error}>✗</text>
          ) : done ? (
            <text fg={colors.success}>
              ✓
              {typeof result?.exitCode === "number" && result.exitCode !== 0
                ? ` (exit ${result.exitCode})`
                : ""}
            </text>
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

import { TextAttributes } from "@opentui/core";

import { Spinner } from "../spinner";
import { EmptyBorder } from "../border";
import type { ThemeColors } from "../../providers/theme/theme";

const MAX_OUTPUT_LINES = 10;
const MAX_LINE_LEN = 120;

function clipLine(line: string): string {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

/** Splits "serverName__toolName" into { server: "serverName", tool: "tool_name" } */
export function parseMcpToolName(toolName: string): { server: string; tool: string } {
  const idx = toolName.indexOf("__");
  if (idx === -1) return { server: "", tool: toolName };
  return { server: toolName.slice(0, idx), tool: toolName.slice(idx + 2) };
}

export function isMcpTool(toolName: string): boolean {
  return toolName.includes("__");
}

export default function McpToolView({
  toolName,
  input,
  output,
  pending,
  error,
  colors,
}: {
  toolName: string;
  input: unknown;
  output?: unknown;
  pending: boolean;
  error?: string;
  colors: ThemeColors;
}) {
  const { server, tool } = parseMcpToolName(toolName);

  // Extract output text — execute() returns a string or { error: string }
  const outputText =
    typeof output === "string"
      ? output
      : output && typeof output === "object" && "error" in output
        ? (output as { error: string }).error
        : undefined;

  const isOutputError =
    output != null && typeof output === "object" && "error" in output;

  const outputLines = outputText?.split("\n").filter(Boolean) ?? [];
  const visibleLines = outputLines.slice(0, MAX_OUTPUT_LINES);
  const overflow = outputLines.length - visibleLines.length;

  // Render input args as "key: value" pairs — skip large/empty values
  const argEntries =
    input && typeof input === "object"
      ? Object.entries(input as Record<string, unknown>).filter(
          ([, v]) => v != null && v !== "",
        )
      : [];

  const done = !pending;

  return (
    <box width="100%">
      {/* Header: [server] tool_name */}
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          <text fg={colors.info} attributes={TextAttributes.DIM}>
            [{server}]
          </text>
          <text>{tool}</text>
          {argEntries.length > 0 && (
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              {argEntries.map(([, v]) => String(v)).join(" ")}
            </text>
          )}
        </box>
        <box>
          {pending ? (
            <Spinner activeColor={colors.info} />
          ) : isOutputError ? (
            <text fg={colors.error}>✗</text>
          ) : done ? (
            <text fg={colors.success}>✓</text>
          ) : null}
        </box>
      </box>

      {/* Output block */}
      {visibleLines.length > 0 && (
        <box
          width="100%"
          border={["left"]}
          borderColor={isOutputError ? colors.error : colors.dimSeparator}
          customBorderChars={{ ...EmptyBorder, vertical: "│" }}
          paddingLeft={1}
          marginTop={1}
        >
          {visibleLines.map((line, i) => (
            <text
              key={i}
              attributes={TextAttributes.DIM}
              fg={isOutputError ? colors.error : undefined}
            >
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

      {!!error && (
        <text fg={colors.error} paddingLeft={2}>
          {error}
        </text>
      )}
    </box>
  );
}

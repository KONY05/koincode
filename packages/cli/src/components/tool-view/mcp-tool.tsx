import { TextAttributes } from "@opentui/core";
import { parseMcpToolName } from "@koincode/shared";

import { Spinner } from "../spinner";
import { EmptyBorder } from "../border";
import type { ThemeColors } from "../../providers/theme/theme";

const MAX_OUTPUT_LINES = 10;
const MAX_LINE_LEN = 120;

function clipLine(line: string): string {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

type McpServerStatus = { name: string; status: string; toolCount: number; error?: string };

export function ManageMcpView({
  pending,
  output,
  error,
  colors,
}: {
  pending: boolean;
  output?: unknown;
  error?: string;
  colors: ThemeColors;
}) {
  const servers = !pending && Array.isArray(output) ? (output as McpServerStatus[]) : null;

  return (
    <box flexDirection="column" gap={0}>
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>MCP servers:</em>
        {pending ? " …" : ""}
        {error ? ` ${error}` : ""}
      </text>
      {servers?.map((s) => (
        <text key={s.name} attributes={TextAttributes.DIM}>
          {"  "}
          <em fg={s.status === "connected" ? colors.success : colors.error}>
            {s.status === "connected" ? "✓" : "✗"}
          </em>
          {" "}{s.name}{s.status === "connected" ? ` (${s.toolCount} tools)` : ""}{s.error ? ` — ${s.error}` : ""}
        </text>
      ))}
      {servers?.length === 0 && (
        <text attributes={TextAttributes.DIM}>{"  "}no servers configured</text>
      )}
    </box>
  );
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

import { TextAttributes } from "@opentui/core";

import type { ThemeColors } from "../../providers/theme/theme";

const MAX_LINE_LEN = 80;

function clipLine(line: string) {
  return line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "…" : line;
}

export default function WriteFilePreview({
  input,
  pending,
  error,
  colors,
}: {
  input: unknown;
  pending: boolean;
  error?: string;
  colors: ThemeColors;
}) {
  if (!input || typeof input !== "object") return null;
  const { path, content } = input as { path?: string; content?: string };
  if (typeof path !== "string") return null;

  const lines = typeof content === "string" ? content.split("\n") : [];
  const preview = lines.slice(0, 3);
  const hasMore = lines.length > 3;

  return (
    <box width="100%">
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          <text>
            <em fg={colors.success}>Write File</em>
          </text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            ›
          </text>
          <text attributes={TextAttributes.DIM}>{path}</text>
          {pending && <text attributes={TextAttributes.DIM}> …</text>}
        </box>
        {!!error && <text fg={colors.error}>✗</text>}
      </box>
      {/* Not shown on failure — the write never happened, so this preview would misleadingly imply it did. */}
      {!error && preview.length > 0 && (
        <box width="100%" paddingLeft={1}>
          {preview.map((line, i) => (
            <text key={i} attributes={TextAttributes.DIM}>
              {clipLine(line)}
            </text>
          ))}
          {hasMore && (
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              …
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

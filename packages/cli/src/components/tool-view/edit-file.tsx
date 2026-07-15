import {
  TextAttributes,
  TreeSitterClient,
  type SyntaxStyle,
} from "@opentui/core";

import type { ThemeColors } from "../../providers/theme/theme";

// Fallback used only before the tool has actually run (no result to read a real
// diff from yet): a naive whole-string preview, with no surrounding file context
// and no real line-level alignment — every old line reads as removed and every
// new line as added, even where most of the block didn't change.
function buildUnifiedDiff(
  path: string,
  oldString: string,
  newString: string,
): string {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");
  const header = `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  const removed = oldLines.map((l) => `-${l}`).join("\n");
  const added = newLines.map((l) => `+${l}`).join("\n");
  return `${header}\n${removed}\n${added}`;
}

export default function EditFileDiff({
  input,
  output,
  pending,
  error,
  colors,
  syntaxStyle,
  treeSitterClient,
}: {
  input: unknown;
  output?: unknown;
  pending: boolean;
  error?: string;
  colors: ThemeColors;
  syntaxStyle: SyntaxStyle;
  treeSitterClient: TreeSitterClient;
}) {
  if (!input || typeof input !== "object") return null;
  const { path: inputPath, oldString, newString } = input as {
    path?: string;
    oldString?: string;
    newString?: string;
  };
  if (typeof inputPath !== "string") return null;

  // Prefer the tool's own returned path (already formatted as <root-label>/<path>
  // for a secondary-root file) over the raw argument the model typed.
  const outputPath =
    !error && output && typeof output === "object"
      ? (output as { path?: string }).path
      : undefined;
  const path = outputPath ?? inputPath;

  const filetype = path.split(".").pop();

  // runEditFile already computes a real unified diff via createPatch on the full
  // before/after file contents (proper line-level diffing, correct file line
  // numbers, unchanged lines shown once as context) — prefer that over the naive
  // whole-string preview whenever the tool has actually finished.
  const realDiff =
    !error &&
    output &&
    typeof output === "object" &&
    typeof (output as { diff?: unknown }).diff === "string"
      ? (output as { diff: string }).diff
      : null;

  // Don't render the diff on failure — the edit was never applied, so a green
  // "added" block next to it would misleadingly read as a successful change.
  const hasDiff =
    !error && typeof oldString === "string" && typeof newString === "string";
  const diffText =
    realDiff ?? (hasDiff ? buildUnifiedDiff(path, oldString!, newString!) : null);

  return (
    <box width="100%">
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          <text>
            <em fg={colors.info}>Edit File</em>
          </text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            ›
          </text>
          <text attributes={TextAttributes.DIM}>{path}</text>
          {pending && <text attributes={TextAttributes.DIM}> …</text>}
        </box>
        {!!error && <text fg={colors.error}>✗</text>}
      </box>
      {diffText && (
        <diff
          diff={diffText}
          view="unified"
          filetype={filetype}
          syntaxStyle={syntaxStyle}
          treeSitterClient={treeSitterClient}
          // Only the real diff's line numbers reflect actual file lines — the naive
          // pending-state fallback always starts counting at 1, which would mislead.
          showLineNumbers={!!realDiff}
          addedSignColor={colors.success}
          removedSignColor={colors.error}
          width="100%"
        />
      )}
      {!!error && (
        <text fg={colors.error} paddingLeft={2}>
          {error}
        </text>
      )}
    </box>
  );
}

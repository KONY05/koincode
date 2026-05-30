import { TextAttributes, TreeSitterClient, type SyntaxStyle } from "@opentui/core";

import type { ThemeColors } from "../../theme";

function buildUnifiedDiff(path: string, oldString: string, newString: string): string {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");
  const header = `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  const removed = oldLines.map((l) => `-${l}`).join("\n");
  const added = newLines.map((l) => `+${l}`).join("\n");
  return `${header}\n${removed}\n${added}`;
}

export default function EditFileDiff({
  input,
  pending,
  error,
  colors,
  syntaxStyle,
  treeSitterClient
}: {
  input: unknown;
  pending: boolean;
  error?: string;
  colors: ThemeColors;
  syntaxStyle: SyntaxStyle;
  treeSitterClient: TreeSitterClient;
}) {
  if (!input || typeof input !== "object") return null;
  const { path, oldString, newString } = input as {
    path?: string;
    oldString?: string;
    newString?: string;
  };
  if (!path) return null;

  const filetype = path.split(".").pop();
  const hasDiff = oldString != null && newString != null;

  return (
    <box width="100%">
      <box flexDirection="row" gap={1}>
        <em fg={colors.info}>Edit File</em>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
        <text attributes={TextAttributes.DIM}>{path}</text>
        {pending && <text attributes={TextAttributes.DIM}> …</text>}
      </box>
      {hasDiff && (
        <diff
          diff={buildUnifiedDiff(path, oldString!, newString!)}
          view="unified"
          filetype={filetype}
          syntaxStyle={syntaxStyle}
          treeSitterClient={treeSitterClient}
          showLineNumbers={false}
          addedSignColor={colors.success}
          removedSignColor={colors.error}
          width="100%"
        />
      )}
      {error && <text fg={colors.error}>{error}</text>}
    </box>
  );
}
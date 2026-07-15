import { TextAttributes } from "@opentui/core";

import type { ThemeColors } from "../../providers/theme/theme";

/**
 * Shared by readFile/listDirectory — both tools take a single `path` argument and
 * return their own formatted version of it (already shortened to <root-label>/<path>
 * for a secondary workspace root by formatWorkspacePath). Prefer that over the raw
 * argument the model typed, same as write-file.tsx/edit-file.tsx.
 */
export default function PathToolView({
  label,
  input,
  output,
  pending,
  error,
  colors,
}: {
  label: string;
  input: unknown;
  output?: unknown;
  pending: boolean;
  error?: string;
  colors: ThemeColors;
}) {
  if (!input || typeof input !== "object") return null;
  const { path: inputPath } = input as { path?: string };
  if (typeof inputPath !== "string") return null;

  const outputPath =
    !error && output && typeof output === "object"
      ? (output as { path?: string }).path
      : undefined;
  const path = outputPath || inputPath;

  return (
    <text attributes={TextAttributes.DIM}>
      <em fg={colors.info}>{label}:</em> {path}
      {pending ? " …" : ""}
      {error ? ` ${error}` : ""}
    </text>
  );
}

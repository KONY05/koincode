import { readFile, writeFile } from "fs/promises";
import { createPatch } from "diff";

import { toolInputSchemas, type WorkspaceRoot } from "@koincode/shared";
import { formatWorkspacePath, resolveFromCwd, assertNoNul } from "./utils";
import { captureSnapshot, hashContent } from "../lib/snapshots";

const normalize = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();

// Some models (e.g. free/small models) emit literal \n instead of real newlines in JSON strings.
const unescape = (s: string) => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "");

export async function runEditFile(input: unknown, roots: WorkspaceRoot[]) {
  const parsed = toolInputSchemas.editFile.parse(input);
  const path = parsed.path;
  const { resolved } = resolveFromCwd(path);
  const displayPath = formatWorkspacePath(resolved, roots);
  const content = await readFile(resolved, "utf-8");
  // Hash of what we read — used below to ensure the file hasn't changed on disk
  // (e.g. another edit to the same file landed while this call was in flight)
  // before we overwrite it. Optimistic concurrency check, see the re-read below.
  const baseHash = hashContent(content);

  // Prefer the raw, unmodified payload strings so edits to text that genuinely
  // contains literal backslashes (e.g. "\n" inside a string literal) aren't
  // mangled. unescape (literal \n -> real newline) is only applied as a
  // fallback, for models that emit literal escapes instead of real characters.
  let oldString = parsed.oldString;
  let newString = parsed.newString;
  let occurrences = content.split(oldString).length - 1;

  // If exact match fails, try with normalized whitespace
  if (occurrences === 0) {
    const normalizedContent = normalize(content);
    const normalizedOldString = normalize(oldString);
    occurrences = normalizedContent.split(normalizedOldString).length - 1;
  }

  // Still no match: retry with the unescaped interpretation of the payload.
  if (occurrences === 0) {
    oldString = unescape(parsed.oldString);
    newString = unescape(parsed.newString);
    occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      const normalizedContent = normalize(content);
      const normalizedOldString = normalize(oldString);
      occurrences = normalizedContent.split(normalizedOldString).length - 1;
    }
  }

  if (occurrences === 0) {
    const lines = content.split("\n").slice(0, 20).join("\n");
    throw new Error(`oldString not found. File starts with:\n${lines}`);
  }
  if (occurrences > 1)
    throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

  // Perform the replacement
  const newContent = content.replace(oldString, newString);

  // Guard against corrupted model payloads: a lone NUL in newString would
  // otherwise be written verbatim and corrupt the file. Reject before writing.
  assertNoNul(newContent, "newString", displayPath);

  // Optimistic concurrency check: re-read the live file and confirm it's still
  // identical to what we based this edit on. If it changed on disk (a concurrent
  // edit to the same file, or an external editor write), refuse to clobber it —
  // the caller re-reads and retries instead of silently losing an edit.
  const current = await readFile(resolved, "utf-8");
  if (hashContent(current) !== baseHash) {
    throw new Error(
      `${displayPath} changed on disk since it was read — re-read the file and retry the edit`,
    );
  }

  await writeFile(resolved, newContent, "utf-8");

  const beforeHash = await captureSnapshot(content);

  // Generate diff preview
  const patch = createPatch(resolved, content, newContent);

  return {
    success: true as const,
    path: displayPath,
    diff: patch,
    snapshot: {
      path: displayPath,
      beforeHash,
      afterHash: hashContent(newContent),
    },
  };
}

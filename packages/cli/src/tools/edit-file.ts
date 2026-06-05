import { readFile, writeFile } from "fs/promises";
import { relative } from "path";
import { createPatch } from "diff";

import { toolInputSchemas } from "@koincode/shared";
import { resolveInsideCwd } from "./utils";

const normalize = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();

export async function runEditFile(input: unknown) {
  const { path, oldString, newString } = toolInputSchemas.editFile.parse(input);
  const { cwd, resolved } = resolveInsideCwd(path);
  const content = await readFile(resolved, "utf-8");

  // Try exact match first
  let occurrences = content.split(oldString).length - 1;

  // If exact match fails, try with normalized whitespace
  if (occurrences === 0) {
    const normalizedContent = normalize(content);
    const normalizedOldString = normalize(oldString);
    occurrences = normalizedContent.split(normalizedOldString).length - 1;
  }

  if (occurrences === 0) {
    const lines = content.split("\n").slice(0, 20).join("\n");
    throw new Error(`oldString not found. File starts with:\n${lines}`);
  }
  if (occurrences > 1)
    throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

  // Perform the replacement
  const newContent = content.replace(oldString, newString);

  await writeFile(resolved, newContent, "utf-8");

  // Generate diff preview
  const patch = createPatch(resolved, content, newContent);

  return {
    success: true as const,
    path: relative(cwd, resolved),
    diff: patch,
  };
}

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

import { toolInputSchemas, type WorkspaceRoot } from "@koincode/shared";
import { formatWorkspacePath, resolveFromCwd } from "./utils";
import { captureSnapshot, hashContent } from "../lib/snapshots";

export async function runWriteFile(input: unknown, roots: WorkspaceRoot[]) {
  const { path, content } = toolInputSchemas.writeFile.parse(input);
  const { resolved } = resolveFromCwd(path);
  const displayPath = formatWorkspacePath(resolved, roots);

  let beforeContent: string | null = null;
  try {
    beforeContent = await readFile(resolved, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf-8");

  const beforeHash = await captureSnapshot(beforeContent);

  return {
    success: true as const,
    path: displayPath,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    snapshot: {
      path: displayPath,
      beforeHash,
      afterHash: hashContent(content),
    },
  };
}

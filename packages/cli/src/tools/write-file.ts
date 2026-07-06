import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative } from "path";

import { toolInputSchemas } from "@koincode/shared";
import { resolveFromCwd } from "./utils";
import { captureSnapshot, hashContent } from "../lib/snapshots";

export async function runWriteFile(input: unknown) {
  const { path, content } = toolInputSchemas.writeFile.parse(input);
  const { cwd, resolved } = resolveFromCwd(path);

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
    path: relative(cwd, resolved),
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    snapshot: {
      path: relative(cwd, resolved),
      beforeHash,
      afterHash: hashContent(content),
    },
  };
}

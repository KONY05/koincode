import { mkdir, writeFile } from "fs/promises";
import { dirname, relative } from "path";

import { toolInputSchemas } from "@koincode/shared";
import { resolveInsideCwd } from "./utils";

export async function runWriteFile(input: unknown) {
  const { path, content } = toolInputSchemas.writeFile.parse(input);
  const { cwd, resolved } = resolveInsideCwd(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf-8");
  return {
    success: true as const,
    path: relative(cwd, resolved),
    bytesWritten: Buffer.byteLength(content, "utf-8"),
  };
}

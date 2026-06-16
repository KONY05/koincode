import { readFile } from "fs/promises";

import { MAX_FILE_SIZE, resolveInsideCwd } from "./utils";
import { toolInputSchemas } from "@koincode/shared";

export async function runReadFile(input: unknown) {
  const { path, offset = 0, limit = MAX_FILE_SIZE } = toolInputSchemas.readFile.parse(input);

  const { resolved } = resolveInsideCwd(path);

  const content = await readFile(resolved, "utf-8");

  const chunk = content.slice(offset, offset + limit);

  const hasMore = offset + limit < content.length;
  
  return hasMore
    ? { content: chunk, truncated: true, totalLength: content.length, nextOffset: offset + limit }
    : { content: chunk, totalLength: content.length };
}

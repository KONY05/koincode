import { readFile } from "fs/promises";
import { toolInputSchemas } from "@koincode/shared";
import { MAX_FILE_SIZE, resolveInsideCwd } from "./utils";

export async function runReadFile(input: unknown) {
  const { path } = toolInputSchemas.readFile.parse(input);
  const { resolved } = resolveInsideCwd(path);
  const content = await readFile(resolved, "utf-8");
  return content.length > MAX_FILE_SIZE
    ? { content: content.slice(0, MAX_FILE_SIZE), truncated: true, totalLength: content.length }
    : { content };
}

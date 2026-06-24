import { relative, resolve } from "path";
import { toolInputSchemas } from "@koincode/shared";
import { MAX_RESULTS, resolveFromCwd } from "./utils";

export async function runGlob(input: unknown) {
  const { pattern, path } = toolInputSchemas.glob.parse(input);
  const { cwd, resolved } = resolveFromCwd(path);
  const glob = new Bun.Glob(pattern);
  const files: string[] = [];
  let truncated = false;

  for await (const match of glob.scan({ cwd: resolved, dot: false, onlyFiles: true })) {
    if (match.includes("node_modules")) continue;
    if (files.length >= MAX_RESULTS) {
      truncated = true;
      break;
    }
    files.push(relative(cwd, resolve(resolved, match)));
  }

  files.sort();
  return { files, ...(truncated ? { truncated: true } : {}) };
}

import { resolve } from "path";
import { toolInputSchemas, type WorkspaceRoot } from "@koincode/shared";
import { formatWorkspacePath, MAX_RESULTS, resolveFromCwd } from "./utils";

export async function runGlob(input: unknown, roots: WorkspaceRoot[]) {
  const { pattern, path } = toolInputSchemas.glob.parse(input);
  const { resolved } = resolveFromCwd(path);
  const glob = new Bun.Glob(pattern);
  const files: string[] = [];
  let truncated = false;

  for await (const match of glob.scan({ cwd: resolved, dot: false, onlyFiles: true })) {
    if (match.includes("node_modules")) continue;
    if (files.length >= MAX_RESULTS) {
      truncated = true;
      break;
    }
    files.push(formatWorkspacePath(resolve(resolved, match), roots));
  }

  files.sort();
  return { files, ...(truncated ? { truncated: true } : {}) };
}

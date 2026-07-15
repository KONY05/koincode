import { readdir, stat } from "fs/promises";
import { join } from "path";
import { toolInputSchemas, type WorkspaceRoot } from "@koincode/shared";
import { formatWorkspacePath, resolveFromCwd } from "./utils";

export async function runListDirectory(input: unknown, roots: WorkspaceRoot[] = []) {
  const { path } = toolInputSchemas.listDirectory.parse(input);
  const { resolved } = resolveFromCwd(path);
  const entries = await readdir(resolved);
  const results: { name: string; type: "file" | "directory" }[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const info = await stat(join(resolved, entry));
    results.push({ name: entry, type: info.isDirectory() ? "directory" : "file" });
  }

  results.sort((a, b) =>
    a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name),
  );
  return { path: formatWorkspacePath(resolved, roots) || ".", entries: results };
}

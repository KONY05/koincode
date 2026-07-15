import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkspaceRoot } from "@koincode/shared";

export type ModifiedFile = {
  path: string;
  added: number;
  removed: number;
  status: "modified" | "added" | "deleted" | "untracked";
};

export type ModifiedFilesGroup = {
  root: WorkspaceRoot;
  files: ModifiedFile[];
};

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], cwd });
}

function countLines(path: string): number {
  try {
    const content = readFileSync(path, "utf8");
    return content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return 0;
  }
}

function getModifiedFilesForRoot(rootPath: string): ModifiedFile[] {
  let porcelain: string;
  try {
    porcelain = run("git status --porcelain", rootPath);
  } catch {
    return [];
  }

  const lines = porcelain.split("\n").filter(Boolean);
  if (lines.length === 0) return [];

  let numstat = "";
  try {
    numstat = run("git diff --numstat HEAD", rootPath);
  } catch {
    // No commits yet (no HEAD) — tracked-file line stats unavailable, fall back to zeros.
  }

  const statByPath = new Map<string, { added: number; removed: number }>();
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, removed, path] = line.split("\t");
    if (!path) continue;
    statByPath.set(path, {
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
    });
  }

  const results: ModifiedFile[] = [];
  for (const line of lines) {
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (!path) continue;

    if (code === "??") {
      results.push({ path, added: countLines(resolve(rootPath, path)), removed: 0, status: "untracked" });
      continue;
    }

    const stat = statByPath.get(path) ?? { added: 0, removed: 0 };

    const status = code.includes("D") ? "deleted" : code.includes("A") ? "added" : "modified";

    results.push({ path, added: stat.added, removed: stat.removed, status });
  }

  return results;
}

/**
 * Reads the working tree's current dirty state via git — not scoped to this session, just
 * whatever's uncommitted right now. Runs once per workspace root when more than one is
 * attached (each is typically its own git repo), returned as one group per root rather than
 * merged, so the UI can render each root as its own separate, independently collapsible
 * section instead of one combined list.
 */
export function getModifiedFiles(roots: WorkspaceRoot[] = []): ModifiedFilesGroup[] {
  if (roots.length === 0) {
    return [
      {
        root: { label: "", path: process.cwd() },
        files: getModifiedFilesForRoot(process.cwd()),
      },
    ];
  }

  return roots.map((root) => ({ root, files: getModifiedFilesForRoot(root.path) }));
}

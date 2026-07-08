import { readFile, unlink, writeFile } from "fs/promises";

import { resolveFromCwd } from "../tools/utils";
import { hashContent, readSnapshot } from "./snapshots";

export type MutationSnapshot = {
  path: string;
  beforeHash: string | null;
  afterHash: string;
};

type ToolPart = {
  type: string;
  state?: string;
  output?: unknown;
};

type MessageLike = {
  parts?: ToolPart[];
};

export type FileRevertPlan =
  | { path: string; kind: "restore"; content: string }
  | { path: string; kind: "delete" }
  | { path: string; kind: "conflict"; reason: string };

function extractSnapshot(part: ToolPart): MutationSnapshot | null {
  if (part.type !== "tool-writeFile" && part.type !== "tool-editFile") return null;

  if (part.state !== "output-available") return null;

  const output = part.output as { snapshot?: MutationSnapshot } | undefined;
  
  return output?.snapshot ?? null;
}

/** Collects writeFile/editFile mutations from a set of messages, oldest first. */
export function collectMutations(messages: MessageLike[]): MutationSnapshot[] {
  const mutations: MutationSnapshot[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const snapshot = extractSnapshot(part);
      if (snapshot) mutations.push(snapshot);
    }
  }
  return mutations;
}

async function currentFileHash(relPath: string): Promise<string | null> {
  const { resolved } = resolveFromCwd(relPath);
  try {
    const content = await readFile(resolved, "utf-8");
    return hashContent(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Groups mutations by file and works out what reverting them means: restore
 * the oldest pre-mutation content, delete the file (it didn't exist before
 * this range), or flag a conflict — the file was touched outside these
 * tracked calls (hand-edited, reformatted, or the snapshot blob is gone) so
 * we don't blindly clobber it.
 */
export async function planRevert(
  mutations: MutationSnapshot[],
): Promise<FileRevertPlan[]> {
  const byPath = new Map<string, MutationSnapshot[]>();
  for (const mutation of mutations) {
    const list = byPath.get(mutation.path) ?? [];
    list.push(mutation);
    byPath.set(mutation.path, list);
  }

  const plans: FileRevertPlan[] = [];
  for (const [path, list] of byPath) {
    const mostRecent = list[list.length - 1]!;
    const currentHash = await currentFileHash(path);
    if (currentHash !== mostRecent.afterHash) {
      plans.push({
        path,
        kind: "conflict",
        reason: "file was modified after the AI's last edit",
      });
      continue;
    }

    let chainBroken = false;
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i]!.beforeHash !== list[i - 1]!.afterHash) {
        chainBroken = true;
        break;
      }
    }
    if (chainBroken) {
      plans.push({
        path,
        kind: "conflict",
        reason: "edit history for this file has an untracked gap",
      });
      continue;
    }

    const oldestBeforeHash = list[0]!.beforeHash;
    if (oldestBeforeHash === null) {
      plans.push({ path, kind: "delete" });
      continue;
    }

    try {
      const content = await readSnapshot(oldestBeforeHash);
      plans.push({ path, kind: "restore", content });
    } catch {
      plans.push({
        path,
        kind: "conflict",
        reason: "original snapshot is no longer available",
      });
    }
  }
  return plans;
}

/** Applies a revert plan. Conflicts are skipped — the caller is expected to have surfaced them for confirmation already. */
export async function applyRevert(plans: FileRevertPlan[]): Promise<void> {
  for (const plan of plans) {
    const { resolved } = resolveFromCwd(plan.path);
    if (plan.kind === "restore") {
      await writeFile(resolved, plan.content, "utf-8");
    } else if (plan.kind === "delete") {
      try {
        await unlink(resolved);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

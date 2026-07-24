import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { GLOBAL_CONFIG_DIR, type WorkspaceRoot } from "@koincode/shared";
import { findInstructionFile, MAX_FILE_SIZE, truncate } from "../tools/utils";

export type InstructionFileSource = "global" | { label: string };

export type InstructionFileEntry = {
  source: InstructionFileSource;
  path: string;
  content: string;
};

/**
 * The global fallback is a single named file, not the full AGENTS.md/CLAUDE.md/CONTEXT.md
 * chain — `~/.koincode/AGENTS.md` first, then `~/.claude/CLAUDE.md` (Claude Code's own
 * global instructions file) if the former doesn't exist. Mirrors opencode's identical choice
 * to piggyback on Claude Code's file rather than inventing a separate convention.
 */
function findGlobalInstructionFile(): { path: string; content: string } | undefined {
  const koincodeGlobal = findInstructionFile(GLOBAL_CONFIG_DIR);
  if (koincodeGlobal) return koincodeGlobal;

  const claudeGlobalPath = join(homedir(), ".claude", "CLAUDE.md");
  try {
    return { path: claudeGlobalPath, content: truncate(readFileSync(claudeGlobalPath, "utf-8"), MAX_FILE_SIZE) };
  } catch {
    return undefined;
  }
}

/**
 * Reads the eager tier fresh — one global file plus one per configured workspace root —
 * immediately before a `/chat` request is sent. Deliberately not cached anywhere: identical
 * bytes on the next call still hit the provider's prompt cache, so re-reading costs nothing
 * in the steady state and picks up a mid-session edit on the very next turn.
 */
export function getInstructionFilesForRequest(roots: WorkspaceRoot[]): InstructionFileEntry[] {
  const entries: InstructionFileEntry[] = [];

  const global = findGlobalInstructionFile();
  if (global) entries.push({ source: "global", ...global });

  for (const root of roots) {
    const found = findInstructionFile(root.path);
    if (found) entries.push({ source: { label: root.label }, ...found });
  }

  return entries;
}

type MessageWithParts = { parts: unknown[] };

/**
 * Scans conversation history for the content already attached by a prior `readFile` call
 * (its `loadedAgentsMd` output field), keyed by path, so the nested tier doesn't re-surface
 * a file whose content is unchanged since it was last shown. Deliberately content-keyed, not
 * just path-keyed: a `Set<path>` would mean an edit to an already-surfaced AGENTS.md is never
 * picked up again for the rest of the session — the tool result the model already has would
 * be permanently stale with no way to refresh it. Comparing the current read against the last
 * *content* shown (not just "was this path ever shown") means an edit is treated the same as
 * a new file: re-attached on the next read that touches it.
 *
 * `messages` is expected to already be sliced to the current session's live boundary by the
 * caller (see `_lastInstructionBoundary` in `use-chat.ts`) — this function itself has no
 * boundary awareness.
 */
export function extractLoadedAgentsMd(messages: MessageWithParts[]): Map<string, string> {
  const loaded = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      const p = part as { type?: string; state?: string; output?: unknown };
      if (p.type !== "tool-readFile" || p.state !== "output-available") continue;

      const output = p.output as { loadedAgentsMd?: unknown } | undefined;
      if (!output || !Array.isArray(output.loadedAgentsMd)) continue;

      for (const entry of output.loadedAgentsMd) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { path?: unknown }).path === "string" &&
          typeof (entry as { content?: unknown }).content === "string"
        ) {
          const { path, content } = entry as { path: string; content: string };
          loaded.set(path, content); // later messages overwrite earlier ones — last shown content wins
        }
      }
    }
  }
  return loaded;
}

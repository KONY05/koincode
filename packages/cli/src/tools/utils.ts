import { readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

import type { WorkspaceRoot } from "@koincode/shared";

/** Priority order checked in every directory for project/instruction conventions — first name found wins, matching opencode's own AGENTS.md/CLAUDE.md/CONTEXT.md convention. */
export const INSTRUCTION_FILENAMES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"] as const;

/**
 * Tries each of `INSTRUCTION_FILENAMES` directly inside `dir`, in priority order, returning
 * the first that exists. Never throws — a missing or unreadable file just means "not found
 * here". Content is capped at `MAX_FILE_SIZE`, same limit already applied to normal file
 * reads (`runReadFile`) — unlike those, there's no offset/pagination story for instruction
 * files (they're injected as a single block, not paginated by the model), so a file over the
 * cap is just truncated once rather than readable in chunks. AGENTS.md/CLAUDE.md files are
 * conventionally short by design, so this is a backstop against an outlier, not an expected
 * everyday limit.
 */
export function findInstructionFile(dir: string): { path: string; content: string } | undefined {
  for (const filename of INSTRUCTION_FILENAMES) {
    const path = join(dir, filename);
    try {
      return { path, content: truncate(readFileSync(path, "utf-8"), MAX_FILE_SIZE) };
    } catch {
      continue;
    }
  }
  return undefined;
}

export const MAX_FILE_SIZE = 10_000;
export const MAX_RESULTS = 200;
export const MAX_MATCHES = 50;
export const MAX_OUTPUT = 20_000;
export const DEFAULT_TIMEOUT = 30_000;

/** Resolve a user-supplied path against `process.cwd()`. Allows absolute and relative paths — permission gating is handled by the approval widget, not here. */
export function resolveFromCwd(path: string) {
  const cwd = process.cwd();
  const resolved = resolve(cwd, path);
  return { cwd, resolved };
}

/**
 * Formats a resolved absolute path for display: bare relative-to-primary-root when the
 * path is under the session's primary (first) root — unchanged from single-root behavior —
 * or `<root-label>/<relative-path>` when it's under a secondary root. Falls back to the raw
 * absolute path if it's under none of the known roots at all.
 */
export function formatWorkspacePath(resolved: string, roots: WorkspaceRoot[]): string {
  for (const [index, root] of roots.entries()) {
    const rel = relative(root.path, resolved);
    if (!rel.startsWith("..")) {
      return index === 0 ? rel : `${root.label}/${rel}`;
    }
  }
  return resolved;
}

/**
 * Walks from `resolvedFilePath`'s directory up to (not including) the nearest workspace
 * root, collecting each level's nearest instruction file via `findInstructionFile` — skipping
 * any whose current content exactly matches what's already in `alreadyLoaded` for that path.
 * Content-keyed rather than path-keyed on purpose: comparing against the *last shown content*
 * (not just "was this path ever shown") means editing an already-surfaced AGENTS.md gets it
 * re-attached on the next read that touches it, instead of the model being stuck with a stale
 * copy for the rest of the session. Deliberately stops before the root itself: the root's own
 * instruction file is already covered by the eager per-root tier (`getInstructionFilesForRequest`),
 * so this can never re-surface it. Also skips a match equal to `resolvedFilePath` itself — reading
 * an instruction file directly (e.g. `readFile("sub/AGENTS.md")`) would otherwise find that same
 * file sitting in its own directory and re-attach its content back onto itself as a redundant
 * `<system-reminder>`, duplicating what's already the read's own primary content. Matches
 * opencode's identical `found === target` guard in `instruction.ts`'s `resolve()`. Returns `[]`
 * if `resolvedFilePath` isn't under any known root.
 */
export function findUnsurfacedAgentsMd(
  resolvedFilePath: string,
  roots: WorkspaceRoot[],
  alreadyLoaded: Map<string, string>,
): { path: string; content: string }[] {
  const root = roots.find(
    (r) => resolvedFilePath === r.path || resolvedFilePath.startsWith(`${r.path}/`),
  );
  if (!root) return [];

  const results: { path: string; content: string }[] = [];
  let current = dirname(resolvedFilePath);

  while (current.startsWith(root.path) && current !== root.path) {
    const found = findInstructionFile(current);
    if (found && found.path !== resolvedFilePath && alreadyLoaded.get(found.path) !== found.content) {
      results.push(found);
    }
    current = dirname(current);
  }

  return results;
}

export function truncate(value: string, limit: number) {
  return value.length > limit
    ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
    : value;
}

/** Same as truncate, but keeps the tail and drops from the top — for delivery
 * text where the most recent output (final errors, completion status) is
 * what matters, unlike the head-truncated live tool-view display. */
export function truncateTail(value: string, limit: number) {
  return value.length > limit
    ? `... (truncated, ${value.length} total chars)\n${value.slice(value.length - limit)}`
    : value;
}

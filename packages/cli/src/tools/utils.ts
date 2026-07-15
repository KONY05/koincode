import { relative, resolve } from "path";
import type { WorkspaceRoot } from "@koincode/shared";

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

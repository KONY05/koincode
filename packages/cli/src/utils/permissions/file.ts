import { basename, isAbsolute, relative, resolve } from "path";
import type { WorkspaceRoot } from "@koincode/shared";

// Single source of truth for sensitive files
export const SENSITIVE_BASE_NAMES = [
  ".env",
  ".pem",
  ".key",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  ".git/config",
  ".koincode/config.json",
];

// Glob searched patterns generated from SENSITIVE_BASE_NAMES
const DEFAULT_SENSITIVE_PATTERNS = [
  ...SENSITIVE_BASE_NAMES.flatMap((name) => [
    name,
    `${name}.*`,
    `**/${name}`,
    `**/${name}.*`,
    `**/*.${name.replace(".", "")}`, // For things like **/*.pem
  ]),
  ".github/workflows/**",
];

export function matchesGlob(filePath: string, pattern: string): boolean {
  try {
    return new Bun.Glob(pattern).match(filePath);
  } catch {
    return false;
  }
}
function isWithinRoot(resolved: string, rootPath: string): boolean {
  const rel = relative(rootPath, resolved);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * A path is "outside project" only if it falls outside every attached workspace
 * root, not just the primary one — a directory added via /add-dir is already an
 * explicit, one-time trust decision, so it shouldn't need a second per-call
 * approval on every read/write inside it, same as the primary root today.
 */
export function isOutsideProject(filePath: string, roots: WorkspaceRoot[] = []): boolean {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);

  if (roots.length === 0) {
    return !isWithinRoot(resolved, cwd);
  }

  return !roots.some((root) => isWithinRoot(resolved, root.path));
}

export function isSensitivePath(
  filePath: string,
  extraPatterns: string[],
  roots: WorkspaceRoot[] = [],
): boolean {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);

  // Match sensitive-file glob patterns (e.g. `.env`, `**/.env`) against whichever
  // attached root actually contains this path, not always the primary cwd — so
  // e.g. a secondary root's own .env is still caught correctly.
  const matchingRoot = roots.find((root) => isWithinRoot(resolved, root.path));
  const rel = matchingRoot
    ? relative(matchingRoot.path, resolved)
    : relative(cwd, resolved);

  const allPatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns];
  if (allPatterns.some((p) => matchesGlob(rel, p))) return true;

  // For outside-project paths, globs like `**/.env` won't match the `../` prefix.
  // Check the filename directly against the base sensitive names.
  if (isOutsideProject(filePath, roots)) {
    const name = basename(resolved);
    return SENSITIVE_BASE_NAMES.some((s) => name === s || name.startsWith(`${s}.`));
  }

  return false;
}
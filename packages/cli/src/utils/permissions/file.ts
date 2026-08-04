import { homedir } from "os";
import { basename, isAbsolute, relative, resolve } from "path";
import type { WorkspaceRoot } from "@koincode/shared";

// Single source of truth for sensitive files.
//
// Also consumed as plain substrings by `isSensitiveFileShellCommand` (shell.ts),
// which is what makes `echo ... > .koincode/agents/x.md` get caught the same way
// a `writeFile` to that path does — otherwise the shell tool would be a trivial
// bypass of every entry here.
export const SENSITIVE_BASE_NAMES = [
  ".env",
  ".pem",
  ".key",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  ".git/config",
  ".koincode/config.json",
  // Agent definitions grant capability: an agent's `tools:` decides what it may
  // call, and its `permission:` overlay can waive approval prompts for normal-tier
  // actions. An agent that can rewrite these can widen its own privileges — or
  // author a brand-new unrestricted agent — and the change persists to the next
  // launch, so it must be a decision the user actually sees.
  ".koincode/agents",
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
  // The generated patterns above match the directory path itself, not files inside
  // it — `.koincode/agents` does not glob-match `.koincode/agents/explorer.md`.
  ".koincode/agents/**",
  "**/.koincode/agents/**",
];

/**
 * Absolute-path check for koincode's own control surfaces — the files that decide
 * what the agent is allowed to do, rather than ordinary project content.
 *
 * Needed alongside the glob patterns because those are matched against a path
 * *relative to a workspace root*, so they can never reach the global
 * `~/.koincode/` directory. Global files are the more dangerous of the two: a
 * global agent definition applies to every project on the machine, not just this
 * one. Without this, writing one would only raise the generic normal-tier "write
 * outside project" prompt rather than being treated as sensitive.
 */
function isKoincodeControlPath(resolved: string, roots: WorkspaceRoot[]): boolean {
  const bases = [
    ...(roots.length > 0 ? roots.map((r) => r.path) : [process.cwd()]),
    homedir(),
  ];

  return bases.some((base) => {
    const rel = relative(resolve(base, ".koincode"), resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) return false;
    return rel === "config.json" || rel === "agents" || rel.startsWith("agents/");
  });
}

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

  // Checked before the globs: these live at absolute locations (including the
  // global `~/.koincode/`) that root-relative patterns can't express.
  if (isKoincodeControlPath(resolved, roots)) return true;

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
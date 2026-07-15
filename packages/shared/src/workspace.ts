/**
 * A single directory attached to a session's workspace.
 *
 * `path` is always an absolute filesystem path. `label` is a short display name
 * (usually the directory's basename) used anywhere a root needs to be shown or
 * addressed compactly — tool output, the sessions dialog, the session footer,
 * `@`-mention autocomplete, etc.
 *
 * A session's `roots` array always has the primary root (wherever the CLI was
 * launched) at index 0; any directories added later via `/add-dir` are appended
 * after it.
 *
 * @example
 * const roots: WorkspaceRoot[] = [
 *   { label: "koincode", path: "/Users/mac/Code/KOINCODE" },
 *   { label: "koincode-review", path: "/Users/mac/Code/KOINCODE-Review" },
 * ];
 */
export type WorkspaceRoot = {
  label: string;
  path: string;
};

/**
 * Parses the `Session.roots` DB column (a JSON string) back into a real array.
 * Never throws — malformed JSON, a non-array, or entries missing `label`/`path`
 * are treated as "no roots" (or that entry is dropped) rather than crashing the
 * request that reads a session.
 *
 * @example
 * parseWorkspaceRoots('[{"label":"koincode","path":"/Users/mac/Code/KOINCODE"}]');
 * # => [{ label: "koincode", path: "/Users/mac/Code/KOINCODE" }]
 *
 * @example
 * parseWorkspaceRoots(null); // => []
 * parseWorkspaceRoots("not json"); // => []
 * parseWorkspaceRoots('[{"label":"x"}]'); // => [] (missing `path`, entry dropped)
 */
export function parseWorkspaceRoots(raw: string | null | undefined): WorkspaceRoot[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is WorkspaceRoot =>
        !!r && typeof r.label === "string" && typeof r.path === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Inverse of {@link parseWorkspaceRoots} — serializes a `WorkspaceRoot[]` back
 * into the JSON string format stored in the `Session.roots` DB column.
 *
 * @example
 * serializeWorkspaceRoots([{ label: "koincode", path: "/Users/mac/Code/KOINCODE" }]);
 * # => '[{"label":"koincode","path":"/Users/mac/Code/KOINCODE"}]'
 */
export function serializeWorkspaceRoots(roots: WorkspaceRoot[]): string {
  return JSON.stringify(roots);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function isSameOrNested(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`);
}

/**
 * Finds an existing root that a candidate path would overlap with — a duplicate,
 * a subdirectory of an existing root, or (the reverse) an existing root that would
 * become redundant because it's nested inside the candidate path. Checked in both
 * directions on purpose: adding `/Code/KOINCODE/packages/cli` when `/Code/KOINCODE`
 * is already a root is a conflict, and so is the reverse — adding `/Code/KOINCODE`
 * when `/Code/KOINCODE/packages/cli` is already a root. `${b}/` (not just `b`) is
 * the nesting check so "/Code/KOINCODE-Review" doesn't false-positive against
 * "/Code/KOINCODE" (shared string prefix, not actually nested).
 *
 * @example
 * findRootConflict("/Code/KOINCODE", [{ label: "koincode", path: "/Code/KOINCODE" }]);
 * / => { label: "koincode", path: "/Code/KOINCODE" }  (exact duplicate)
 *
 * @example
 * findRootConflict("/Code/KOINCODE-Review", [{ label: "koincode", path: "/Code/KOINCODE" }]);
 * / => undefined  (sibling directory, not nested — safe to add)
 */
export function findRootConflict(
  path: string,
  existingRoots: WorkspaceRoot[],
): WorkspaceRoot | undefined {
  return existingRoots.find(
    (r) => isSameOrNested(path, r.path) || isSameOrNested(r.path, path),
  );
}

/**
 * Picks a display label for a directory being added as a new workspace root.
 * Defaults to the directory's basename; if that collides with a label already
 * in use, prefixes it with the parent directory's name to disambiguate.
 *
 * @example
 * makeRootLabel("/Users/mac/Code/KOINCODE-Review", []);
 * / => "KOINCODE-Review"
 *
 * @example
 * / Two different directories that happen to share a basename ("api"):
 * makeRootLabel(
 *   "/Users/mac/Code/backend/api",
 *   [{ label: "api", path: "/Users/mac/Code/frontend/api" }],
 * );
 * / => "backend/api"
 */
export function makeRootLabel(path: string, existingRoots: WorkspaceRoot[]): string {
  const name = basename(path);
  if (!existingRoots.some((r) => r.label === name)) return name;

  const segments = path.split("/").filter(Boolean);
  const parent = segments[segments.length - 2];
  return parent ? `${parent}/${name}` : name;
}

import { basename, isAbsolute, relative, resolve } from "path";

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
export function isOutsideProject(filePath: string): boolean {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  return rel.startsWith("..") || isAbsolute(rel);
}

export function isSensitivePath(filePath: string, extraPatterns: string[]): boolean {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);

  const allPatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns];
  if (allPatterns.some((p) => matchesGlob(rel, p))) return true;

  // For outside-project paths, globs like `**/.env` won't match the `../` prefix.
  // Check the filename directly against the base sensitive names.
  if (isOutsideProject(filePath)) {
    const name = basename(resolved);
    return SENSITIVE_BASE_NAMES.some((s) => name === s || name.startsWith(`${s}.`));
  }

  return false;
}
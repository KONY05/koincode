import { isAbsolute, relative, resolve } from "path";

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
export function isSensitivePath(filePath: string, extraPatterns: string[]): boolean {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);

  if (rel.startsWith("..") || isAbsolute(rel)) return true;

  const allPatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns];
  return allPatterns.some((p) => matchesGlob(rel, p));
}
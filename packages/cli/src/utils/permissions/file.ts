import { isAbsolute, relative, resolve } from "path";

const DEFAULT_SENSITIVE_PATTERNS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/id_ed25519",
  "**/id_ecdsa",
  ".git/config",
  ".github/workflows/**",
  ".koincode/config.json",
];

function matchesGlob(filePath: string, pattern: string): boolean {
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
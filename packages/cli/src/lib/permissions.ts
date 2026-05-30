import { isAbsolute, relative, resolve } from "path";

export type PermissionTier = "normal" | "destructive";

export type PermissionKey =
  | "shell:git"
  | "shell:npm"
  | "shell:rm"
  | "shell:write"
  | "shell:unknown"
  | "file:sensitive";

export type PendingApproval = {
  key: PermissionKey;
  label: string;
  description: string;
  tier: PermissionTier;
};

export type ApprovalResponse =
  | { type: "allow-once" }
  | { type: "allow-for-project" }
  | { type: "deny" };

type PermissionInfo =
  | { requiresApproval: false }
  | ({ requiresApproval: true } & PendingApproval);

const SHELL_BIN_MAP: Record<string, { key: PermissionKey; label: string; tier: PermissionTier }> = {
  git:  { key: "shell:git", label: "Run git command",   tier: "normal" },
  npm:  { key: "shell:npm", label: "Run npm",           tier: "normal" },
  bun:  { key: "shell:npm", label: "Run bun",           tier: "normal" },
  yarn: { key: "shell:npm", label: "Run yarn",          tier: "normal" },
  pnpm: { key: "shell:npm", label: "Run pnpm",          tier: "normal" },
  npx:  { key: "shell:npm", label: "Run npx",           tier: "normal" },
  bunx: { key: "shell:npm", label: "Run bunx",          tier: "normal" },
  rm:    { key: "shell:rm",    label: "Delete files",       tier: "destructive" },
  rmdir: { key: "shell:rm",    label: "Delete directory",   tier: "destructive" },
  mv:   { key: "shell:write", label: "Move files",         tier: "normal" },
  cp:   { key: "shell:write", label: "Copy files",         tier: "normal" },
  tee:  { key: "shell:write", label: "Write via tee",      tier: "normal" },
};

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

function isSensitivePath(filePath: string, extraPatterns: string[]): boolean {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);

  if (rel.startsWith("..") || isAbsolute(rel)) return true;

  const allPatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns];
  return allPatterns.some((p) => matchesGlob(rel, p));
}

function getShellPermissionInfo(command: string): PermissionInfo {
  const bin = command.trim().split(/\s+/)[0] ?? "";
  const mapped = SHELL_BIN_MAP[bin];

  if (mapped) {
    return { requiresApproval: true, ...mapped, description: command };
  }

  return {
    requiresApproval: true,
    key: "shell:unknown",
    label: "Run shell command",
    description: command,
    tier: "normal",
  };
}

export function getPermissionInfo(
  toolName: string,
  input: unknown,
  extraSensitivePatterns: string[] = [],
): PermissionInfo {
  switch (toolName) {
    case "shell": {
      const { command } = input as { command: string };
      return getShellPermissionInfo(command);
    }
    case "writeFile":
    case "editFile": {
      const { path } = input as { path: string };
      if (isSensitivePath(path, extraSensitivePatterns)) {
        return {
          requiresApproval: true,
          key: "file:sensitive",
          label: "Write to sensitive file",
          description: path,
          tier: "destructive",
        };
      }
      return { requiresApproval: false };
    }
    default:
      return { requiresApproval: false };
  }
}

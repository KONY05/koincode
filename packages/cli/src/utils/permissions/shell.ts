import type { PendingApproval, PermissionInfo, PermissionKey, PermissionTier } from ".";
import { matchesGlob, SENSITIVE_BASE_NAMES } from "./file";

const SHELL_BIN_MAP: Record<
  string,
  { key: PermissionKey; label: string; tier: PermissionTier }
> = {
  git: { key: "shell:git", label: "Run git command", tier: "normal" },
  npm: { key: "shell:npm", label: "Run npm", tier: "normal" },
  bun: { key: "shell:npm", label: "Run bun", tier: "normal" },
  yarn: { key: "shell:npm", label: "Run yarn", tier: "normal" },
  pnpm: { key: "shell:npm", label: "Run pnpm", tier: "normal" },
  npx: { key: "shell:npm", label: "Run npx", tier: "normal" },
  bunx: { key: "shell:npm", label: "Run bunx", tier: "normal" },
  cd: { key: "shell:cd", label: "Change directory", tier: "normal" },
  rm: { key: "shell:rm", label: "Delete files", tier: "destructive" },
  rmdir: { key: "shell:rm", label: "Delete directory", tier: "destructive" },
  mv: { key: "shell:write", label: "Move files", tier: "normal" },
  cp: { key: "shell:write", label: "Copy files", tier: "normal" },
  tee: { key: "shell:write", label: "Write via tee", tier: "normal" },
  sudo: { key: "shell:sudo", label: "Run command as root", tier: "destructive" },
  su: { key: "shell:sudo", label: "Run command as root", tier: "destructive" },
  bash: { key: "shell:interpreter", label: "Run script via bash", tier: "destructive" },
  sh: { key: "shell:interpreter", label: "Run script via sh", tier: "destructive" },
  zsh: { key: "shell:interpreter", label: "Run script via zsh", tier: "destructive" },
  node: { key: "shell:interpreter", label: "Run script via node", tier: "destructive" },
  python: { key: "shell:interpreter", label: "Run script via python", tier: "destructive" },
  python3: { key: "shell:interpreter", label: "Run script via python3", tier: "destructive" },
  ruby: { key: "shell:interpreter", label: "Run script via ruby", tier: "destructive" },
  perl: { key: "shell:interpreter", label: "Run script via perl", tier: "destructive" },
  php: { key: "shell:interpreter", label: "Run script via php", tier: "destructive" },
};

/**
 * Split a shell command string into individual sub-commands on the shell
 * operators: && || ; |   — while ignoring operators inside single/double quotes.
 */
function splitSubcommands(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      // && or ||
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
        parts.push(current.trim());
        current = "";
        i++; // skip second char
        continue;
      }
      // single ; or |
      if (ch === ";" || ch === "|") {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function extractBaseBinary(cmd: string): string {
  const tokens = cmd.trim().split(/\s+/);
  for (const token of tokens) {
    // Skip environment variables like NODE_ENV=production
    if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(token)) {
      continue;
    }
    return token;
  }
  return "";
}

function hasSubshell(command: string): boolean {
  return command.includes("$(") || command.includes("`");
}

type AtomicClassification = { requiresApproval: true } & PendingApproval & {
    isCdOnly: boolean;
  };

/** Classify a single atomic command (no operators) by its leading binary. */
function classifyAtomicCommand(cmd: string): AtomicClassification {
  const bin = extractBaseBinary(cmd);
  const mapped = SHELL_BIN_MAP[bin];

  if (mapped) {
    return {
      requiresApproval: true,
      ...mapped,
      description: cmd,
      isCdOnly: mapped.key === "shell:cd",
    };
  }

  const fallbackBin = bin || "unknown";
  return {
    requiresApproval: true,
    key: `shell:bin:${fallbackBin}` as PermissionKey,
    label: `Run ${fallbackBin}`,
    description: cmd,
    tier: "normal",
    isCdOnly: false,
  };
}

const TIER_RANK: Record<PermissionTier, number> = { normal: 0, destructive: 1 };

function getKeyRank(key: PermissionKey): number {
  if (key === "shell:cd") return 0;
  if (key === "shell:git" || key === "shell:npm") return 1;
  if (key === "shell:write") return 2;
  if (key === "shell:rm") return 3;
  if (key.startsWith("shell:bin:")) return 4;
  if (
    key === "shell:sudo" ||
    key === "file:sensitive" ||
    key === "shell:subshell" ||
    key === "shell:interpreter"
  ) {
    return 5;
  }
  return 4; // fallback for any missing key
}

const SYSTEM_SENSITIVE_SUBSTRINGS = [
  ".zshrc",
  ".bashrc",
  ".bash_profile",
  ".bash_history",
  ".ssh",
  "/etc/passwd",
  "/etc/shadow",
  "~/.config",
  ".github/workflows",
];

function isSensitiveFileShellCommand(command: string, extraPatterns: string[]): boolean {
  const defaultSubstrings = [
    ...SENSITIVE_BASE_NAMES,
    ...SYSTEM_SENSITIVE_SUBSTRINGS,
  ];

  if (defaultSubstrings.some((sub) => command.includes(sub))) {
    return true;
  }

  if (extraPatterns.length > 0) {
    const tokens = command.split(/\s+/);
    for (const token of tokens) {
      if (extraPatterns.some((p) => matchesGlob(token, p))) {
        return true;
      }
    }
  }

  return false;
}

function hasWriteRedirection(command: string): boolean {
  // Ignore > or >> inside quotes.
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === ">") {
      return true;
    }
  }
  return false;
}

export default function getShellPermissionInfo(
  command: string,
  extraPatterns: string[] = []
): PermissionInfo {
  if (hasSubshell(command)) {
    return {
      requiresApproval: true,
      key: "shell:subshell",
      label: "Run command with subshell",
      description: command,
      tier: "destructive",
    };
  }

  if (isSensitiveFileShellCommand(command, extraPatterns)) {
    return {
      requiresApproval: true,
      key: "file:sensitive",
      label: "Access sensitive file via shell",
      description: command,
      tier: "destructive",
    };
  }

  const subcommands = splitSubcommands(command);

  // Classify each sub-command.
  const classified = subcommands.map(classifyAtomicCommand);

  // Filter out bare `cd` sub-commands — they are safe redirects, not meaningful actions.
  // If ALL sub-commands are `cd`, still classify the whole thing as `shell:cd`.
  const meaningful = classified.filter((c) => !c.isCdOnly);
  const toMerge = meaningful.length > 0 ? meaningful : classified;

  // Pick the most-significant classification (highest key rank, then tier).
  let winner = toMerge.reduce<AtomicClassification | undefined>(
    (best, cur) => {
      if (!best) return cur;
      const keyWins = getKeyRank(cur.key) > getKeyRank(best.key);
      const tierWins =
        getKeyRank(cur.key) === getKeyRank(best.key) &&
        TIER_RANK[cur.tier] > TIER_RANK[best.tier];
      return keyWins || tierWins ? cur : best;
    },
    undefined,
  );

  if (hasWriteRedirection(command)) {
    if (!winner || getKeyRank(winner.key) < getKeyRank("shell:write")) {
      // Elevate to shell:write
      winner = {
        requiresApproval: true,
        key: "shell:write",
        label: "Write via shell redirection",
        description: command,
        tier: "normal",
        isCdOnly: false,
      };
    }
  }

  if (!winner) {
    return {
      requiresApproval: true,
      key: "shell:bin:unknown",
      label: "Run shell command",
      description: command,
      tier: "normal",
    };
  }

  return {
    requiresApproval: true,
    key: winner.key as PermissionKey,
    label: winner.label,
    // Always show the full original command as the description.
    description: command,
    tier: winner.tier as PermissionTier,
  };
}

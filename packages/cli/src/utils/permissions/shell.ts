import type { PendingApproval, PermissionInfo, PermissionKey, PermissionTier } from ".";

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

type AtomicClassification = { requiresApproval: true } & PendingApproval & {
    isCdOnly: boolean;
  };

/** Classify a single atomic command (no operators) by its leading binary. */
function classifyAtomicCommand(cmd: string): AtomicClassification {
  const bin = cmd.trim().split(/\s+/)[0] ?? "";
  const mapped = SHELL_BIN_MAP[bin];

  if (mapped) {
    return {
      requiresApproval: true,
      ...mapped,
      description: cmd,
      isCdOnly: mapped.key === "shell:cd",
    };
  }

  return {
    requiresApproval: true,
    key: "shell:unknown",
    label: "Run shell command",
    description: cmd,
    tier: "normal",
    isCdOnly: false,
  };
}

const TIER_RANK: Record<PermissionTier, number> = { normal: 0, destructive: 1 };
const KEY_RANK: Record<PermissionKey, number> = {
  "shell:cd": 0,
  "shell:git": 1,
  "shell:npm": 1,
  "shell:write": 2,
  "shell:rm": 3,
  "shell:unknown": 4,
  "file:sensitive": 5,
};

export default function getShellPermissionInfo(
  command: string,
): PermissionInfo {
  const subcommands = splitSubcommands(command);

  // Classify each sub-command.
  const classified = subcommands.map(classifyAtomicCommand);

  // Filter out bare `cd` sub-commands — they are safe redirects, not meaningful actions.
  // If ALL sub-commands are `cd`, still classify the whole thing as `shell:cd`.
  const meaningful = classified.filter((c) => !c.isCdOnly);
  const toMerge = meaningful.length > 0 ? meaningful : classified;

  // Pick the most-significant classification (highest key rank, then tier).
  const winner = toMerge.reduce<AtomicClassification | undefined>(
    (best, cur) => {
      if (!best) return cur;
      const keyWins = KEY_RANK[cur.key] > KEY_RANK[best.key];
      const tierWins =
        KEY_RANK[cur.key] === KEY_RANK[best.key] &&
        TIER_RANK[cur.tier] > TIER_RANK[best.tier];
      return keyWins || tierWins ? cur : best;
    },
    undefined,
  );

  if (!winner) {
    return {
      requiresApproval: true,
      key: "shell:unknown",
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

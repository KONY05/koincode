import type { AgentPermission } from "@koincode/shared";

import type { PermissionInfo, PermissionTier } from ".";

/**
 * Per-agent permission overlay (Feature 54, Decision 6).
 *
 * Applied *on top of* the risk classifier in `index.ts`/`shell.ts`, never in place
 * of it. The classifier stays code-owned and is the floor; an agent file can make
 * it stricter freely, and looser only where the classifier itself said the action
 * was routine.
 *
 * Rules:
 * - `ask`   — always honoured. An agent can demand confirmation for anything.
 * - `deny`  — always honoured. Refuses the call outright, with no prompt.
 * - `allow` — honoured **only when the classifier tier is `normal`**. A
 *   `destructive` classification (`shell:rm`, `shell:sudo`, `shell:interpreter`,
 *   `file:sensitive`) can never be silenced by an agent file, no matter what the
 *   frontmatter says. This is the whole reason the classifier is kept: it is the
 *   one judgement no user config can dig under.
 */

export type OverlayOutcome =
  /** Refuse the tool call outright, no prompt. */
  | { action: "deny"; rule: string }
  /** Prompt the user, even if the classifier didn't require it. */
  | { action: "ask"; info: Extract<PermissionInfo, { requiresApproval: true }> }
  /** Proceed with whatever the classifier decided. */
  | { action: "defer" };

/**
 * Matches an overlay key against a tool call. Supports, most specific first:
 *   1. the classifier's permission key   — `shell:rm`, `file:sensitive`
 *   2. the tool name                     — `shell`, `editFile`, `github__create_issue`
 *   3. a trailing wildcard               — `shell:*`, `github__*`, `*`
 */
function findRule(
  permission: AgentPermission,
  toolName: string,
  permissionKey: string | undefined,
): { value: "allow" | "ask" | "deny"; rule: string } | undefined {
  const candidates = permissionKey ? [permissionKey, toolName] : [toolName];

  for (const candidate of candidates) {
    const exact = permission[candidate];
    if (exact) return { value: exact, rule: candidate };
  }

  // Wildcards: longest prefix wins, so `shell:*` beats a bare `*`.
  const wildcards = Object.keys(permission)
    .filter((k) => k.endsWith("*"))
    .sort((a, b) => b.length - a.length);

  for (const pattern of wildcards) {
    const prefix = pattern.slice(0, -1);
    if (candidates.some((c) => c.startsWith(prefix))) {
      return { value: permission[pattern]!, rule: pattern };
    }
  }

  return undefined;
}

export function applyAgentPermissionOverlay(
  info: PermissionInfo,
  permission: AgentPermission | undefined,
  toolName: string,
): OverlayOutcome {
  if (!permission) return { action: "defer" };

  const permissionKey = info.requiresApproval ? info.key : undefined;
  const rule = findRule(permission, toolName, permissionKey);
  if (!rule) return { action: "defer" };

  if (rule.value === "deny") {
    return { action: "deny", rule: rule.rule };
  }

  if (rule.value === "ask") {
    // Already prompting — nothing to escalate.
    if (info.requiresApproval) return { action: "defer" };
    return {
      action: "ask",
      info: {
        requiresApproval: true,
        key: `agent:${rule.rule}` as Extract<PermissionInfo, { requiresApproval: true }>["key"],
        label: `Run ${toolName}`,
        description: `Required by this agent's permission rule "${rule.rule}"`,
        tier: "normal" as PermissionTier,
        sessionOnly: true,
      },
    };
  }

  // rule.value === "allow" — de-escalation, permitted for `normal` tier only.
  if (info.requiresApproval && info.tier === "destructive") {
    return { action: "defer" };
  }

  return { action: "defer" };
}

/**
 * Whether an agent's `allow` rule should skip the approval prompt for this call.
 * Split out from `applyAgentPermissionOverlay` because the caller needs it at a
 * different point: after the classifier has demanded approval, but before the
 * prompt is shown.
 */
export function isAllowedByAgentOverlay(
  info: Extract<PermissionInfo, { requiresApproval: true }>,
  permission: AgentPermission | undefined,
  toolName: string,
): boolean {
  if (!permission) return false;
  // Destructive is the floor — an agent file cannot buy its way past it.
  if (info.tier === "destructive") return false;

  const rule = findRule(permission, toolName, info.key);
  return rule?.value === "allow";
}

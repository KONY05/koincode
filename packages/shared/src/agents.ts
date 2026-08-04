import { z } from "zod";

import {
  browserToolContracts,
  buildToolContracts,
  buildToolContractsWithBrowser,
  Mode,
  readOnlyToolContracts,
  type ToolContracts,
} from "./schemas";

/**
 * Agent registry (Feature 54, step a).
 *
 * BUILD and PLAN stop being a hardcoded two-value enum and become the first two
 * entries in a registry that user-defined agents join later. This module is
 * contracts + pure resolution only — it never touches the filesystem. Loading
 * agent markdown files is the CLI's job (step b), mirroring how `lib/skills.ts`
 * owns skill loading while the schema lives here.
 *
 * Import direction is one-way: `agents.ts` → `schemas.ts`. `getToolContracts`
 * moved here rather than staying in `schemas.ts` precisely to avoid a cycle,
 * since it now needs the registry to answer.
 */

/** Every tool name that exists in any contract set. */
export type ToolName = keyof ToolContracts;

/**
 * Runtime narrowing for `ToolName`, so a `string[]` arriving from outside the
 * process (an agent file, a chat request) can be filtered into `ToolName[]`
 * without an unchecked `as` assertion.
 */
export function isToolName(name: string): name is ToolName {
  // `Object.hasOwn`, not `in` — `in` walks the prototype chain, so "toString",
  // "constructor" and friends would report as valid tool names.
  return Object.hasOwn(buildToolContractsWithBrowser, name);
}

/**
 * An agent's identifier. Deliberately a bare string rather than a union: the set of
 * valid ids is whatever the user's `.koincode/agents/` directory contains, so it
 * cannot be known at compile time. This is what replaces `ModeType` at every site
 * that *carries* a selected agent — `ModeType` remains for the two built-in
 * constants themselves (`Mode.BUILD` / `Mode.PLAN`), which are still exhaustive.
 */
export type AgentId = string;

/**
 * How an agent may be invoked. Mirrors opencode's `mode` field, renamed to
 * `kind` here because `mode` is already this codebase's word for BUILD/PLAN and
 * reusing it for "primary vs subagent" would be actively confusing.
 */
export const AgentKind = {
  PRIMARY: "primary",
  SUBAGENT: "subagent",
  ALL: "all",
} as const;

export type AgentKindType = (typeof AgentKind)[keyof typeof AgentKind];

export const agentKindSchema = z.enum([
  AgentKind.PRIMARY,
  AgentKind.SUBAGENT,
  AgentKind.ALL,
]);

/**
 * Per-agent permission overlay, applied on top of the CLI's risk classifier
 * (`utils/permissions/`) rather than replacing it. Keys are permission keys or
 * tool names; enforcement lands in step (c).
 *
 * `deny` here means "this specific invocation is refused" — distinct from
 * leaving a tool out of `tools` entirely, which is how a *tool* is denied
 * (Decision 4: denial by omission, so the model can't even attempt it).
 */
export const agentPermissionSchema = z.record(
  z.string(),
  z.enum(["allow", "ask", "deny"]),
);

export type AgentPermission = z.infer<typeof agentPermissionSchema>;

/**
 * Frontmatter accepted in an agent markdown file. The body of the file (not
 * covered here) becomes the agent's prompt section.
 *
 * `tools` omitted means "everything BUILD gets" — matching opencode's general
 * agent, and the least surprising default for someone whose first agent file is
 * just a prompt with a description.
 */
export const agentFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string(),
  mode: agentKindSchema.default(AgentKind.PRIMARY),
  tools: z.array(z.string()).optional(),
  permission: agentPermissionSchema.optional(),
  model: z.string().optional(),
});

export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

export type AgentDefinition = {
  /** Stable identifier. Built-ins keep the literal "BUILD"/"PLAN" strings that
   *  already sit in persisted `ChatMessageMetadata.mode`, so existing sessions
   *  keep resolving after this change. */
  id: string;
  label: string;
  description: string;
  kind: AgentKindType;
  tools: readonly ToolName[];
  /** Markdown body used as this agent's prompt section. Undefined for built-ins,
   *  whose canonical sections are still rendered by the server's `getModeSection`. */
  prompt?: string;
  model?: string;
  permission?: AgentPermission;
  builtin: boolean;
  /** Whether the user's opt-in browser tool flag may add browser tools to this
   *  agent. False for read-only agents — browser/server tools drive real
   *  processes and have no business in a read-only posture. */
  allowsBrowserTools: boolean;
};

/**
 * The wire shape of an agent on a chat request.
 *
 * Agents are loaded client-side (the server never reads the filesystem), so the
 * resolved definition travels with each request. This lives in shared rather than
 * in the server route because it is a contract *between* the two packages: the CLI
 * produces it, the server validates and consumes it, and the system prompt renders
 * from it. Defining it in the route meant the prompt builder carried a hand-written
 * copy of the same shape, which is how the two drift.
 *
 * A subset of `AgentDefinition`: `model` is resolved client-side before the request
 * is built, and `permission` is enforced entirely client-side (the server never
 * evaluates it), so neither is sent.
 */
export const agentWireSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  kind: agentKindSchema,
  tools: z.array(z.string()),
  prompt: z.string().optional(),
  builtin: z.boolean(),
  allowsBrowserTools: z.boolean(),
});

export type AgentWire = z.infer<typeof agentWireSchema>;

/** One row of the agent manifest injected into the system prompt (Decision 11). */
export const agentManifestEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  kind: agentKindSchema,
  builtin: z.boolean(),
});

export type AgentManifestEntry = z.infer<typeof agentManifestEntrySchema>;

const READ_ONLY_TOOL_NAMES = Object.keys(readOnlyToolContracts) as ToolName[];
const BUILD_TOOL_NAMES = Object.keys(buildToolContracts) as ToolName[];

export const BUILD_AGENT_ID = Mode.BUILD;
export const PLAN_AGENT_ID = Mode.PLAN;

/**
 * `description` is written as selection criteria, not as a title — once agents
 * are injected into the system prompt as a manifest (Decision 11), this is the
 * text the model chooses between them on.
 */
export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  {
    id: BUILD_AGENT_ID,
    label: "Build",
    description:
      "Implement changes directly. Use when the task requires writing files or running commands.",
    kind: AgentKind.PRIMARY,
    tools: BUILD_TOOL_NAMES,
    builtin: true,
    allowsBrowserTools: true,
  },
  {
    id: PLAN_AGENT_ID,
    label: "Plan",
    description:
      "Analyze, research and propose without changing anything. Use when the task is investigation rather than implementation.",
    kind: AgentKind.PRIMARY,
    tools: READ_ONLY_TOOL_NAMES,
    builtin: true,
    allowsBrowserTools: false,
  },
];

/**
 * Resolves an agent id against the registry, falling back to BUILD (Decision 10).
 *
 * The fallback is deliberately BUILD rather than a nearest-name match: a session
 * whose agent file was deleted or renamed must not be silently handed a
 * *different* permission posture than the one its history was produced under.
 * Matching is case-insensitive so a hand-written `build` resolves the same as the
 * persisted `BUILD`.
 */
export function resolveAgent(
  agentId: string | undefined | null,
  agents: readonly AgentDefinition[] = BUILTIN_AGENTS,
): AgentDefinition {
  const fallback =
    agents.find((agent) => agent.id === BUILD_AGENT_ID) ?? agents[0] ?? BUILTIN_AGENTS[0]!;

  if (!agentId) return fallback;

  const target = agentId.toLowerCase();
  return agents.find((agent) => agent.id.toLowerCase() === target) ?? fallback;
}

/** Whether an agent can be selected as a top-level mode (Tab / agents dialog). */
export function isPrimaryAgent(agent: AgentDefinition): boolean {
  return agent.kind === AgentKind.PRIMARY || agent.kind === AgentKind.ALL;
}

/** Whether an agent can be delegated to via spawnAgent / `@mention`. */
export function isSubagent(agent: AgentDefinition): boolean {
  return agent.kind === AgentKind.SUBAGENT || agent.kind === AgentKind.ALL;
}

/**
 * Whether this agent can change the user's machine — write/edit a file or run a
 * shell command.
 *
 * This is the question the BUILD/PLAN distinction was always really asking, and
 * it's what the UI's yellow-vs-purple accent has always communicated: yellow means
 * "this can modify things", purple means "read-only". Deriving it from the agent's
 * actual tools (rather than its id) is what keeps that signal honest once an agent
 * can be any shape — a custom agent with `shell` must not look read-only just
 * because it isn't named BUILD.
 *
 * Also gates the switchMode confirmation prompt, so the model can't quietly acquire
 * write access by switching into an innocuously-named agent.
 */
export function agentCanMutate(agent: AgentDefinition): boolean {
  return (
    agent.tools.includes("writeFile") ||
    agent.tools.includes("editFile") ||
    agent.tools.includes("shell")
  );
}

/**
 * Builds the tool set for an agent.
 *
 * Iterates the master contract object rather than the agent's own `tools` array
 * so key order always matches `buildToolContractsWithBrowser`. That ordering is
 * load-bearing: `withToolsCacheControl` (server `lib/prompt-caching.ts`) marks
 * the *last* key as the Anthropic cache breakpoint, and a reordered tool list is
 * a different cache prefix. It also means an unknown tool name in a user's
 * `tools:` array is ignored rather than injected as a broken entry.
 */
export function resolveToolContracts(
  agent: AgentDefinition,
  browserTools?: boolean,
): Partial<ToolContracts> {
  const allowed = new Set<string>(agent.tools);
  const includeBrowser = browserTools === true && agent.allowsBrowserTools;

  const resolved: Record<string, unknown> = {};
  for (const [name, contract] of Object.entries(buildToolContractsWithBrowser)) {
    const isBrowserTool = Object.hasOwn(browserToolContracts, name);
    if (allowed.has(name) || (includeBrowser && isBrowserTool)) {
      resolved[name] = contract;
    }
  }

  return resolved as Partial<ToolContracts>;
}

/**
 * Registry-backed replacement for the old two-branch `getToolContracts(mode)`.
 * Signature is unchanged for callers, which still pass "BUILD"/"PLAN" today.
 */
export function getToolContracts(
  agentId: string,
  browserTools?: boolean,
  agents: readonly AgentDefinition[] = BUILTIN_AGENTS,
): Partial<ToolContracts> {
  return resolveToolContracts(resolveAgent(agentId, agents), browserTools);
}

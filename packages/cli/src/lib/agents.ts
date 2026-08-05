import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  agentFrontmatterSchema,
  BUILTIN_AGENTS,
  isPrimaryAgent,
  isResolvableModelId,
  isSubagent,
  resolveAgent,
  type AgentDefinition,
  type AgentId,
  type AgentKindType,
  type AgentManifestEntry,
  type AgentWire,
  type AgentPermission,
  type ToolName,
  buildToolContracts,
} from "@koincode/shared";

import { readGlobalConfig } from "../utils/configs/global-config";
import { parseFrontmatter } from "./frontmatter";

/**
 * Agent file loader (Feature 54, step b).
 *
 * Deliberately mirrors `lib/skills.ts`: same scan → parse → merge → cache shape,
 * same project > global > builtin precedence, same process-lifetime cache with an
 * explicit invalidation hook. The one structural difference is that an agent is a
 * *single* markdown file (`reviewer.md`), not a directory with a SKILL.md inside —
 * agents have no scripts/assets to carry alongside them.
 */

export type AgentScope = "project" | "global" | "builtin";

export type ResolvedAgent = AgentDefinition & {
  scope: AgentScope;
  /** Absolute path of the file this came from. Empty for built-ins. */
  filePath: string;
};

/** A non-fatal problem found while loading an agent file. Surfaced in the UI rather than thrown. */
export type AgentLoadWarning = {
  filePath: string;
  agentId: string;
  message: string;
};

const BUILD_TOOL_NAMES = Object.keys(buildToolContracts) as ToolName[];

function agentsDirs(): { dir: string; scope: Exclude<AgentScope, "builtin"> }[] {
  return [
    { dir: resolve(process.cwd(), ".koincode", "agents"), scope: "project" },
    { dir: resolve(homedir(), ".koincode", "agents"), scope: "global" },
  ];
}

/**
 * The shared frontmatter parser (`lib/frontmatter.ts`) handles `key: value` and
 * `key: [a, b]` but not nested maps, which `permission:` needs. Rather than
 * hand-rolling a YAML parser, a `{...}` value is read as inline JSON — so a
 * permission overlay is written as `permission: {"shell:rm": "ask"}` on one line.
 * Documented in the spec; kept deliberately narrow.
 *
 * A malformed block degrades to "no permission overlay" the same way an unknown
 * tool or unresolvable model degrades elsewhere in this file — but unlike those,
 * it must warn: dropping the whole map silently would make an agent whose author
 * typo'd their JSON look like it's enforcing rules it silently isn't (e.g. a
 * `deny` an agent file believes is active but never loaded).
 */
function coerceInlineJson(
  value: unknown,
  agentId: string,
  filePath: string,
  warnings: AgentLoadWarning[],
): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    warnings.push({
      filePath,
      agentId,
      message: `invalid \`permission\` JSON (${error instanceof Error ? error.message : String(error)}) — permission rules ignored`,
    });
    return undefined;
  }
}

function readAgentFile(
  filePath: string,
  scope: Exclude<AgentScope, "builtin">,
  customModelIds: readonly string[],
  warnings: AgentLoadWarning[],
): ResolvedAgent | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const fileName = filePath.split("/").at(-1) ?? "";
  const idFromFile = fileName.replace(/\.md$/i, "");

  const { meta, body } = parseFrontmatter(raw);
  const parsed = agentFrontmatterSchema.safeParse({
    ...meta,
    permission: coerceInlineJson(meta.permission, idFromFile, filePath, warnings),
  });

  if (!parsed.success) {
    warnings.push({
      filePath,
      agentId: idFromFile,
      message: `invalid frontmatter (${parsed.error.issues.map((i) => `${i.path.join(".") || "?"}: ${i.message}`).join("; ")}) — agent skipped`,
    });
    return null;
  }

  const front = parsed.data;
  const id = (front.name ?? idFromFile).trim();
  if (!id) return null;

  // Unknown tool names are dropped rather than failing the agent — same posture as
  // `resolveToolContracts`, which ignores them when building the contract set.
  // Without the warning they'd vanish silently and look like a working restriction.
  let tools: readonly ToolName[];
  if (front.tools) {
    const known = new Set<string>(BUILD_TOOL_NAMES);
    const unknown = front.tools.filter((t) => !known.has(t));
    if (unknown.length > 0) {
      warnings.push({
        filePath,
        agentId: id,
        message: `unknown tool(s) ignored: ${unknown.join(", ")}`,
      });
    }
    tools = front.tools.filter((t): t is ToolName => known.has(t));
  } else {
    // Frontmatter omitting `tools` means full BUILD access — see agentFrontmatterSchema.
    tools = BUILD_TOOL_NAMES;
  }

  // Step (e): an unresolvable model drops the field and inherits the session model,
  // rather than failing the agent or blowing up at request time inside the chat route.
  let model = front.model;
  if (model && !isResolvableModelId(model, customModelIds)) {
    warnings.push({
      filePath,
      agentId: id,
      message: `unknown model '${model}', inheriting session model`,
    });
    model = undefined;
  }

  return {
    id,
    // Capitalized for display, matching the built-ins' "Build"/"Plan". `id` stays
    // exactly as written — it's what switchMode, @mentions and persisted metadata
    // match on, and resolution is case-insensitive anyway.
    label: id.charAt(0).toUpperCase() + id.slice(1),
    description: front.description,
    kind: front.mode as AgentKindType,
    tools,
    prompt: body || undefined,
    model,
    permission: front.permission as AgentPermission | undefined,
    builtin: false,
    // A user-defined agent gets browser tools only if it actually asked for them,
    // so an agent scoped to a handful of read tools can't have nine browser/server
    // tools appear just because the user has the global browser flag on.
    allowsBrowserTools: front.tools
      ? front.tools.some((t) => t.startsWith("browser") || t.startsWith("server"))
      : true,
    scope,
    filePath,
  };
}

function scanAgentsDir(
  dir: string,
  scope: Exclude<AgentScope, "builtin">,
  customModelIds: readonly string[],
  warnings: AgentLoadWarning[],
): ResolvedAgent[] {
  if (!existsSync(dir)) return [];
  const agents: ResolvedAgent[] = [];
  try {
    // Sorted by filename: `readdirSync` returns filesystem order, which varies by
    // platform and by the order files happened to be created. Agent order is
    // user-visible — it's the Tab cycle and the dialog list — so it has to be
    // stable across machines rather than incidentally whatever the FS returns.
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const agent = readAgentFile(join(dir, entry.name), scope, customModelIds, warnings);
      if (agent) agents.push(agent);
    }
  } catch {
    // ignore unreadable dirs
  }
  return agents;
}

/**
 * Scans project + global agent directories and resolves the full registry,
 * project > global > builtin, deduped by id (case-insensitive, first-seen wins).
 * Built-ins are always present and always last in precedence, so a user file
 * named `build.md` overrides BUILD rather than duplicating it.
 *
 * Deliberately uncached — every call re-reads the filesystem. An earlier version
 * cached this for the process lifetime and layered an explicit invalidation call
 * on top, which meant every consumer (the agents dialog, `@`-mention candidates,
 * Tab cycling) needed its own trigger to know when to ask for fresh data, and one
 * such trigger (a mid-mount state update to refresh the dialog) crashed OpenTUI's
 * reconciler (`Text must be created inside of a text node`) and had to be
 * reverted — see the Feature 54 spec's "Mid-session reload" section. A directory
 * of a handful of small markdown files is cheap enough to just re-scan on every
 * call; that removes the entire "when do we invalidate" question rather than
 * answering it more carefully.
 */
function scanAllAgents(): { agents: ResolvedAgent[]; warnings: AgentLoadWarning[] } {
  const warnings: AgentLoadWarning[] = [];
  const customModelIds = (readGlobalConfig().customModels ?? []).map((m) => m.id);

  const found: ResolvedAgent[] = [];
  for (const { dir, scope } of agentsDirs()) {
    found.push(...scanAgentsDir(dir, scope, customModelIds, warnings));
  }

  const builtins: ResolvedAgent[] = BUILTIN_AGENTS.map((agent) => ({
    ...agent,
    scope: "builtin" as const,
    filePath: "",
  }));

  // Precedence and display order are separate concerns.
  //
  // Precedence: user files are scanned first so a `build.md` *overrides* the BUILD
  // built-in rather than duplicating it (first-seen wins).
  //
  // Display order: built-ins come first, because they're the agents every user
  // shares and the ones the Tab cycle should start from — user agents read as
  // additions below them, in both the dialog and the cycle. An override keeps the
  // built-in's slot rather than jumping to the bottom, so replacing BUILD's
  // definition doesn't also reshuffle where it sits.
  const seen = new Set<string>();
  const deduped: ResolvedAgent[] = [];
  for (const agent of [...found, ...builtins]) {
    const key = agent.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(agent);
  }

  const builtinOrder = BUILTIN_AGENTS.map((a) => a.id.toLowerCase());
  const slotOf = (agent: ResolvedAgent) => builtinOrder.indexOf(agent.id.toLowerCase());
  const inBuiltinSlot = deduped
    .filter((a) => slotOf(a) !== -1)
    .sort((a, b) => slotOf(a) - slotOf(b));
  const rest = deduped.filter((a) => slotOf(a) === -1);

  return { agents: [...inBuiltinSlot, ...rest], warnings };
}

/** Returns every available agent. See `scanAllAgents` — always a fresh scan. */
export function loadAgents(): ResolvedAgent[] {
  return scanAllAgents().agents;
}

/** Warnings from a fresh scan of every agent file. */
export function getAgentLoadWarnings(): AgentLoadWarning[] {
  return scanAllAgents().warnings;
}

/**
 * Agents selectable as a top-level mode (Tab / agents dialog).
 *
 * The `kind` test lives in `isPrimaryAgent`/`isSubagent` (shared) rather than being
 * inlined here: `all` counts as both, so the two predicates overlap, and having the
 * rule written twice is how they drift.
 */
export function loadPrimaryAgents(): ResolvedAgent[] {
  return loadAgents().filter(isPrimaryAgent);
}

/** Agents delegable via spawnAgent / `@mention`. */
export function loadSubagents(): ResolvedAgent[] {
  return loadAgents().filter(isSubagent);
}

/**
 * The agent half of a chat request body.
 *
 * Agents live on the client (the server never touches the filesystem), so the
 * resolved definition travels on the wire the same way `skillsManifest` already
 * does — the server needs the tool list and prompt body to build the request, and
 * the manifest so the model knows which agents it can switch to or delegate to
 * (Decision 11).
 */
export function getAgentPayloadForRequest(agentId: AgentId): {
  agent: AgentWire;
  agentsManifest: AgentManifestEntry[];
} {
  const agents = loadAgents();
  const active = resolveAgent(agentId, agents);

  return {
    agent: {
      id: active.id,
      label: active.label,
      description: active.description,
      kind: active.kind,
      tools: [...active.tools],
      prompt: active.prompt,
      builtin: active.builtin,
      allowsBrowserTools: active.allowsBrowserTools,
    },
    agentsManifest: agents.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      kind: a.kind,
      builtin: a.builtin,
    })),
  };
}
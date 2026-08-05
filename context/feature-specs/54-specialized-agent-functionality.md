# Feature 54: User-Defined Agents

## Origin

Original note:

> i was doing some research as to how other ai harness agents work and found some functionalities i saw that i liked, it was an ad video i saw and i saw that users can configure their own custom agent mode, just like how we have build mode and plan mode, users can now add their own dedicated agent mode, and it follows the same tab to switch agent mode and the dialog, but i'm not really sure as to how the functionality works, my initial thought is that users write a md file for their agent mode which will act as kind of like the system prompt for the agent, and then they can add their own custom tools etc, but i thought it's best we make research from opencode since they've been in the game since. so i want us to research how they do their, here's their github to make research
>
> https://github.com/anomalyco/opencode/tree/dev/packages/opencode

## Research: how opencode does it

Sources: [opencode.ai/docs/agents](https://opencode.ai/docs/agents/) and `packages/opencode/src/agent/agent.ts` in `anomalyco/opencode` (dev branch).

The original note's instinct was right — it is markdown files with frontmatter.

**Definition files.** `~/.config/opencode/agents/` (global) or `.opencode/agents/` (project). Filename becomes the agent name (`review.md` → `review`). Same thing can also be declared inline in `opencode.json` under an `agent` key.

**Frontmatter fields:** `description` (required), `mode` (`primary` | `subagent` | `all`), `model`, `temperature`, `topP`, `steps`, `permission`, `prompt`, `color`, `hidden`, `disable`.

**One agent concept, not two.** This is the design decision that matters most and the one the original note didn't anticipate. opencode has a single `Info` struct; the `mode` field decides whether an agent is Tab-cycled as a top-level mode, invoked as a subagent via `@mention` in a child session, or both. Build and Plan are just built-in `primary` agents; general, explore and scout are built-in `subagent`s; compaction/title/summary are hidden utility agents built on the same struct.

**Permissions are a per-agent declarative ruleset**, not an allow-list: tool-name wildcard patterns → `allow` | `ask` | `deny`, with a nested command-pattern map as a special case for bash.

```yaml
permission:
  edit: deny
  bash:
    "git push": ask
    "grep *": allow
```

Resolution is layered: defaults → built-in agent permissions → user config patch, computed and cached per agent. A user config entry can `disable: true` a built-in agent.

Notably, opencode's Plan agent is **not** read-only by omission — the edit tool still exists and is set to `ask`.

## How this maps onto what KOINCODE already has

The blocker is that `Mode` is a closed two-value enum threaded through four packages:

| Location | Current shape |
|---|---|
| `packages/shared/src/schemas.ts:4-9` | `Mode` const + `modeSchema` zod enum |
| `packages/shared/src/schemas.ts:477-480` | `getToolContracts(mode)` — branches on `PLAN`, returns one of two frozen sets |
| `packages/shared/src/schemas.ts:148` | `spawnAgent.startingMode` typed `modeSchema` |
| `packages/shared/src/schemas.ts:350` | `switchMode` description hardcodes "PLAN … and BUILD" |
| `packages/server/src/prompts/system-prompt.ts:147` | `getModeSection(mode)` — if/else over two literal prompt strings |
| `packages/server/src/routes/chat.ts:66,110,122,164,311` | request validation, tool resolution, message metadata, prompt build |
| `packages/server/src/routes/chat.ts:482,499,504` | `/agent-step` (sub-agent orchestration) takes `mode` the same way |
| `packages/cli/src/components/dialogs/agents-dialog.tsx:6` | `AVAILABLE_MODES` is a two-element literal array |

The work is therefore not "add a third dialog entry" — it is **turning `mode` from a closed enum into an agent identifier that resolves to a capability set** (prompt section + tool contracts + optional model + permission overlay). Once that resolution exists, BUILD and PLAN become two built-in registry entries and nothing downstream cares how many there are.

Most of the ingredients already exist:

- **File-based markdown + frontmatter + scope resolution** — skills already do exactly this (`packages/cli/src/lib/skills.ts`: `parseFrontmatter`, `scanSkillsDir`, project → global → builtin merge order, `invalidateSkillsCache`). An agent loader is that same loader with a different frontmatter schema.
- **Per-subagent model** — Feature 52 already added `subagentModel` (`packages/shared/src/config.ts:132`); a per-agent `model:` generalizes it.
- **Subagent execution** — `spawnAgent` / `checkAgentTask` / `/agent-step` already run child agents with a starting mode, turn cap, timeout and background mode.
- **Permission approval machinery** — Features 10, 10.1–10.3 already built the classify → prompt → persist loop.

## The permission model: how ours actually differs from opencode's

KOINCODE does not have "an allow-list". It has **two separate layers**, and the distinction drives the design below.

**Layer 1 — tool visibility.** `getToolContracts(mode)` returns one of two frozen contract sets. This decides what the model can *see* in its tool schema. PLAN's read-only guarantee is structural: `writeFile` is simply absent from the request.

**Layer 2 — runtime approval.** `getPermissionInfo()` (`packages/cli/src/utils/permissions/index.ts:46`) is a **risk classifier**, not an access-control policy. It takes a tool call's real arguments and derives a risk key + tier:

- `shell` → `permissions/shell.ts` splits the command on `&& || ; |` (respecting quotes), maps each sub-command's binary through `SHELL_BIN_MAP` → `shell:rm` (destructive), `shell:git` (normal), `shell:interpreter` (destructive), `shell:sudo` (destructive), etc.
- `writeFile` / `editFile` → `file:sensitive` (destructive) or `file:outside:<dir>` (normal, session-only)
- MCP tools → `mcp:<server>`

The user then answers `allow-once` / `allow-for-project` / `allow-for-session` / `deny`; project grants persist to `packages/cli/src/utils/configs/project-config.ts:12`.

### The four real differences

1. **Authorship.** Every KOINCODE rule is authored by us, in TypeScript — `SHELL_BIN_MAP` is a hand-maintained table, `getPermissionInfo` is a switch with a case per tool. opencode's ruleset is authored by the *user*, per agent, in frontmatter. Today a KOINCODE user cannot express "this agent may edit files but must ask before `git push`" at all. That missing surface is the actual feature.
2. **Keying.** Ours keys on *derived risk categories*; theirs keys on *tool names as wildcard patterns*. Ours is meaningfully smarter per-domain — subshell detection, interpreter detection, sensitive-path matching are analysis a glob over a command string cannot do.
3. **States.** Theirs: uniform `allow` / `ask` / `deny`. Ours: layer 1 is a hard binary (visible / absent), layer 2 is prompt / no-prompt, and there is no user-expressible `deny`.
4. **Layering.** Theirs merges defaults → built-in → user patch per agent. Ours has no merge step, because with two hardcoded modes there was nothing to merge.

### Latent bug this feature would expose

`permissions` in `project-config.ts` is a **flat map, not scoped by mode**. Grant `shell:rm` "for project" under a permissive agent, then Tab into a locked-down `reviewer` agent — the grant still applies. This is invisible today only because BUILD and PLAN can never disagree (PLAN never surfaces a shell prompt at all). The moment agents have differing permission postures, persisted grants leak across them. Scoping persisted grants by agent is **part of this feature**, not a follow-up.

## Decisions

1. **Unify primary agents and subagents into one concept**, following opencode. An agent definition carries `mode: primary | subagent | all`. Rationale: today a subagent is a *call* (`spawnAgent` with an ad-hoc task string), not a named configured thing — keeping them separate creates two overlapping config surfaces that will drift. The built-in `code-review` skill (`packages/cli/src/skills/builtins.ts`) is already a hand-rolled "named subagent with a fixed prompt and a restricted tool set", which is evidence the unified shape is the one that was wanted anyway.

2. **Agent definitions are markdown + frontmatter**, resolved project → global → builtin, reusing the skills loader's conventions and cache-invalidation behavior.

3. **`Mode` becomes an agent registry.** BUILD and PLAN become built-in entries whose `tools` happen to match today's two frozen sets. `modeSchema` (a `z.enum`) becomes an agent-id string validated against the resolved registry.

4. **Keep denial-by-omission for full denials.** Do not adopt opencode's "tool exists but is set to `ask`" approach for hard denials. Omission is structurally stronger (the model cannot attempt what it cannot see) and cheaper in tokens. `ask` applies only to tools that are present.

5. **Keep the risk classifier as an un-overridable floor.** It stays code-owned and applies to every agent regardless of frontmatter. No user config can make `sudo rm -rf` silent.

6. **Add a per-agent `permission:` overlay on top of the classifier.** It may always *escalate* — classifier says "no prompt needed", agent says `ask` → ask. It may *de-escalate* (`allow`, skipping the prompt) **only for `normal` tier**. A `destructive`-tier classification (`shell:rm`, `shell:sudo`, `shell:interpreter`, `file:sensitive`) can never be silenced by an agent file, no matter what the frontmatter says. This is the floor referenced in decision 5, stated concretely: the tier the classifier assigns is what gates whether the overlay is even consulted for a downgrade.

7. **The markdown body replaces the `getModeSection` slot only**, not the whole system prompt. A user writing `reviewer.md` must not have to re-explain tool contracts, workspace roots, memory, or instruction-file conventions — those sections of `buildSystemPrompt` are unaffected.

8. **No per-agent `temperature` / `topP`.** Not exposed anywhere in KOINCODE today and they interact badly with reasoning-effort models (Feature 44).

9. **Persisted project permission grants must be scoped by agent** — see the latent bug above.

10. **Unknown agent id falls back to BUILD.** If a session's persisted message metadata names an agent that no longer resolves (file deleted, project switched, typo in a hand-edited config), resolve to the BUILD built-in rather than erroring or picking a "nearest" match. Rationale: BUILD is the existing default and always resolves; a silent nearest-match could hand a session a *different* permission posture than the one its history was produced under, which is exactly the leak decision 9 exists to prevent.

11. **`switchMode` can target any resolved agent, user-defined ones included** — not just built-ins. Two consequences that make this a real design constraint rather than a one-line schema change:
    - The tool's input schema is **built per-request from the resolved registry**, so its shape varies per project. This mirrors how `getToolContracts` already varies the tool set per mode, so it is not a new kind of variance in the request.
    - The model needs to *know what agents exist* to choose between them. Resolved agents are therefore injected into the system prompt as a **name + description manifest**, exactly as `skillsManifest` already is (`routes/chat.ts:110,311`) — the same mechanism, for the same reason. `description` in agent frontmatter is required precisely because it is what the model selects on, which also means it must be written as selection criteria ("use this when…"), not as a title.

12. **`@` mention invokes an agent as a reference in the chat.** The `@` handler already exists (`packages/cli/src/components/input-bar.tsx:97-139` parses the token, `getMentionCandidates` populates the picker, `handleMentionExecute:691-714` inserts the chosen path inline as plain text) — it is currently file/directory-only. Agents become an additional candidate group in that same picker, shown above file results, inserting `@<agent-name>` as literal text.

    **What the mention does on submit:** nothing special in the CLI. It stays plain text. Because the agent manifest is already in the system prompt (decision 11), the model reads `@reviewer` and delegates by calling `spawnAgent` with that agent id itself. This is deliberately the same shape as skills — a skill is not intercepted or executed by the CLI either; it is listed in the prompt and the model chooses to read and follow it. No new dispatch path, no CLI-side interception, and the user keeps the ability to mention an agent conversationally ("what would @reviewer say about this?") without it forcibly spawning anything.

    **Collision risk:** `@` currently means "file path", so `@reviewer` is ambiguous if a top-level directory named `reviewer` also exists. Mitigated rather than eliminated — agents render as their own labelled group in the picker so selection is unambiguous for the *user*, and inserted file mentions almost always carry a `/` or an extension, so a bare `@name` matching a known agent is unambiguous enough for the *model*. The residual edge case (a top-level directory whose name exactly matches an agent) is accepted, not solved.

13. **Per-agent `model:` ships, but as the last step (e), not in the first cut.** The field is parsed and validated by the registry from step (a) onward and simply ignored until step (e) wires resolution through. Rationale: the mapping concern turned out to be a non-issue (see the section above — provider is carried by the registry entry, not parsed from the string), and the validation rules are a small, well-precedented change. What justifies the sequencing is the **vision gap**: honouring an agent's model correctly requires threading an *effective model* through the image-attachment check, which is a second correctness surface with nothing to do with agents as a concept. Landing it last keeps that fix from blocking the registry, dialog, permission and subagent work, and keeps a half-wired `model:` from silently doing nothing while appearing to work.

    Note the caching consequence stands regardless of sequencing: agents pinned to *different* models share no cache prefix in either direction, unlike same-model agents (see the caching section). That is a reason to advise pinning sparingly in the eventual docs, not a reason to withhold the field.

## Caching impact — assessed, not a blocker

A mid-session agent switch invalidates the prompt cache. This is **already true today** for BUILD ↔ PLAN and the mechanism is unchanged: a switch rewrites both the system prompt and the tool list, and both sit ahead of `messages` in Anthropic's cumulative `tools → system → messages` prefix, so the history breakpoint dies with them (`packages/server/src/lib/prompt-caching.ts`). More agents does not change this mechanism.

**Assessed and accepted.** The cost of a switch is bounded at roughly one uncached turn — the next turn under the new agent re-establishes a prefix and the turn after that hits it again. It is not a permanent tax, and for agents sharing a model it is better than that: cache entries are keyed by exact prefix content, so switching *back* to a previously-used agent within the cache TTL re-hits that agent's still-warm prefix rather than paying to rebuild it. Frequent Tab-cycling between a small set of same-model agents is therefore close to free after the first pass through them.

The one case that does not benefit: agents on **different models**. Caches are per-model, so there is no prefix sharing at all across a model boundary and no warm-back on return — every switch is genuinely cold in both directions. This is a reason to weigh per-agent `model:` on its own merits (open question 2), not a reason to constrain the agent count.

`promptCaching` itself is derived from the resolved model (`routes/chat.ts:309`), so a per-agent model override flows through correctly with no extra work — a non-caching model simply disables caching rather than sending a broken Anthropic `cacheControl` to a foreign provider.

## Per-agent `model:` — resolution and validation

### There is no arbitrary model → provider mapping to solve

`resolveChatModel` (`packages/server/src/lib/models.ts:386-393`) is a three-way branch on **id shape**, not a parse of the model name:

```ts
if (modelId.startsWith("ollama/"))  return resolveOllamaModel(modelId);
if (modelId.startsWith("custom/"))  return resolveCustomModel(modelId);
const model = findSupportedChatModel(modelId);
if (!model) throw new Error(`Unsupported model: ${modelId}`);
return resolveSupportedChatModel(model, effort);
```

Provider is a **property of the resolved entry**, never inferred from the string:

- **Curated models** — `SUPPORTED_CHAT_MODELS` entries carry `provider` explicitly; `resolveSupportedChatModel` switches on that field.
- **`custom/…`** — `resolveCustomModel` (`models.ts:362`) looks up `CustomModelConfig` → its `providerId` → the `CustomProviderConfig` holding `baseURL` + `apiKey`. The user declared the provider when they added the model.
- **`ollama/…`** — the prefix *is* the provider.

So an agent's `model:` is not a free-text model name: it is **a KOINCODE model id**, the same id space the `/models` dialog writes and Feature 52's `subagentModel` already stores.

**Explicitly rejected: opencode's `anthropic/claude-sonnet-4-…` provider-prefixed format.** They need a provider prefix because they resolve dynamically against models.dev; KOINCODE's registry already carries provider per entry. Adopting their string shape would invent a parsing/mapping problem that does not currently exist.

### The real risk is validation looseness, not mapping

`isSupportedChatModel` (`models.ts:295`) — already the zod refine on both chat endpoints — is:

```ts
return findSupportedChatModel(modelId) != null || isCustomOrOllamaModelId(modelId);
```

The second clause is a **prefix check only**. `custom/nonexistent` passes validation and then throws `Custom model not configured` at `models.ts:366` *inside the request*, i.e. a 500 mid-turn. This is tolerable today because `subagentModel` is only ever written by a picker dialog. Agent files are hand-authored markdown, so typos become the expected case rather than the exception, and request-time failure is the wrong landing spot.

### Rules

Follows Feature 52's precedent (`prompt-config/index.tsx:85-94`: "a stale/deleted custom model id … should just fall back to inheriting the session model"), with one tightening:

1. **Validate at registry load**, in the same pass that parses the agent's frontmatter — never at request time.
2. **Degrade the field, not the agent.** An unresolvable `model:` drops that one field; the agent still loads and inherits the session model. A single typo must not make an agent silently vanish from the Tab list.
3. **Surface it** — warn on load (`reviewer.md: unknown model 'claude-sonet-5', inheriting session model`). Silent inheritance is indistinguishable from "I forgot to set it".
4. **Tighten the check for `custom/`** — a new `isResolvableModelId` that looks the id up in `customModels` instead of trusting the prefix (a sync file read, cheap enough for load time). **`ollama/` stays optimistic**: verifying it requires a live call to the Ollama daemon, which cannot happen during a sync registry load, so an unreachable or removed Ollama model still fails at request time exactly as it does today.

### Two knock-on effects, once the id resolves fine

- **Reasoning effort — already safe, no work.** `resolveChatModel(modelId, effort)` receives the effort chosen for the *session's* model. If an agent swaps to a model with a different or absent effort ladder, `supportsEffort` (`models.ts:178`) already gates it and it degrades to the provider default.
- **Vision — a genuine gap.** `checkVisionModel(model)` (`input-bar.tsx:673`, via `use-image-attachment.ts:149`) validates image submission against the **session** model. A vision-capable session delegating to an agent pinned to a text-only model would let an image past the check and fail at the provider. The check must run against the *effective* model for whichever agent handles the turn. **This is a hard prerequisite for shipping `model:`, not a follow-up.**

## Net-new work (sketch — not yet broken into implementation steps)

1. **`@koincode/shared`** — agent definition schema (frontmatter fields, `mode`, `tools`, `permission` overlay); replace `modeSchema`'s `z.enum` with registry-validated agent-id resolution, with unknown ids resolving to BUILD (Decision 10); make `switchMode`'s input schema built per-request from the registry rather than hardcoded (Decision 11).
2. **`@koincode/cli`** — agent file loader (mirroring `lib/skills.ts`, including its cache-invalidation behavior); registry merge (project → global → builtin); `agents-dialog.tsx` reads the registry instead of `AVAILABLE_MODES`; agent candidates added to the `@` mention picker's `getMentionCandidates` as a labelled group above file results (Decision 12); permission overlay applied at `getPermissionInfo`'s call site with the tier check from Decision 6; per-agent scoping of persisted grants in `project-config.ts`.
3. **`@koincode/server`** — `getModeSection` becomes "render this agent's prompt body"; `buildSystemPrompt` gains an agent manifest section alongside the existing skills manifest (Decision 11); `buildSystemPrompt` and both chat endpoints (`/chat`, `/agent-step`) accept an agent id + resolved capability set instead of a mode enum.
4. **No database changes** — agent id rides in the existing `ChatMessageMetadata` JSON blob where `mode` already lives (`routes/chat.ts:164`).

5. **Per-agent `model:` (step e)** — `isResolvableModelId` in `@koincode/shared`; load-time validation + warning surface in the agent loader; effective-model threading so `checkVisionModel` validates against the agent's model rather than the session's.

Per `ai-workflow-rules.md`, this spans three packages and mixes CLI UI, shared contracts and server orchestration, so it **must be split** into at least: (a) registry + shared contracts with BUILD/PLAN as built-ins and no behavior change, (b) file loading + dialog, (c) permission overlay + grant scoping, (d) subagent unification, (e) per-agent `model:` resolution + the vision fix.

## Open questions

All questions from the first draft are resolved and folded into Decisions 6 and 10–13.

The one remaining judgement call — **is per-agent `model:` in v1?** — is settled by sequencing rather than by cutting the field, recorded as Decision 13 below.

## Explicitly out of scope

- Custom *tools* (user-authored executables registered as tool contracts). The original note mentions "add their own custom tools" — MCP already covers this (Feature 23), and a second extension mechanism is not justified.
- opencode's `color` / `hidden` / `disable` frontmatter fields.
- Hidden utility agents for compaction/title/summary — KOINCODE already handles these as dedicated prompts (`compaction-prompt.ts`, `handoff-prompt.ts`, Feature 17) and folding them into the agent registry is a refactor with no user-facing benefit.
- Inline agent definitions in `config.json`. Markdown files only, one surface.

## Agent file format

```markdown
---
description: Review code for bugs without changing anything. Use for read-only audits.
mode: all                                  # primary | subagent | all (default: primary)
tools: [readFile, grep, glob, listDirectory]   # omit for full BUILD access
model: claude-haiku-4-5                    # optional; unresolvable ids warn + inherit
permission: {"shell:npm": "allow", "editFile": "ask", "browser*": "deny"}
---

You are a meticulous code reviewer. Report findings; never modify files.
```

Files live in `.koincode/agents/*.md` (project) or `~/.koincode/agents/*.md` (global). Filename is the agent id unless `name:` overrides it.

**`permission` uses inline JSON, not nested YAML.** The frontmatter parser shared with skills (`lib/skills.ts`'s `parseFrontmatter`) handles `key: value` and `key: [a, b]` only. Rather than hand-roll a YAML parser for one field, a `{...}` value is read as inline JSON. Keys match, most specific first: the classifier's permission key (`shell:rm`), the tool name (`editFile`), then a trailing wildcard (`shell:*`, `*`), longest prefix winning.

## Status

**Implemented — all five steps (a)–(e) complete.** No open questions remain.

- **(a) Registry + shared contracts** — `packages/shared/src/agents.ts`; BUILD/PLAN as built-in entries; `getToolContracts` moved out of `schemas.ts`; Decision 10 fallback. Zero behavior change, proven by key-order and object-identity equality with the previous frozen tool sets.
- **(b) File loading + dialog** — `packages/cli/src/lib/agents.ts`; agents dialog and Tab cycle read the registry; `@` mention picker gained an agent group; agent payload + manifest ride the chat request like `skillsManifest`; server renders a custom prompt body and the manifest section.
- **(c) Permission overlay + grant scoping** — `utils/permissions/agent-overlay.ts` implements Decision 6's tier rule; project grants moved to `agentPermissions[agentId]`, with legacy flat grants honoured for built-ins only.
- **(d) Subagent unification** — `spawnAgent`'s `startingMode` is an agent id; sub-agents run as registry agents with their own prompt, tools, model and permission overlay; `/agent-step` accepts the agent payload.
- **(e) Per-agent `model:`** — `isResolvableModelId` in shared; load-time validation degrades a bad id to a warning; `checkVisionModel` and the api-key check both run against the effective model.

### Deviations from this spec, found during implementation

1. **`AgentId` was introduced rather than widening `ModeType`.** `ModeType` stays a two-value union for the built-in constants; every site that *carries* a selected agent moved to `AgentId = string`. Widening `ModeType` itself would have silently allowed any string everywhere `Mode.BUILD` is used.
2. **Two gates that keyed off `mode === Mode.BUILD` now key off capability**, because an agent id stopped being a proxy for what an agent can do:
   - the switchMode confirmation prompt fires when the *target agent can mutate* (`agentCanMutate`: `writeFile`/`editFile`/`shell`), not when it is literally named BUILD;
   - the system prompt's browser section gates on the agent's resolved tools plus the user's browser flag.

   The **visualization** section gates on `shell` specifically, and deliberately *not* on `agentCanMutate`. Its final step is "open it using the `shell` tool", so an agent without shell cannot complete the workflow however it produced the file — it would just call a tool it doesn't have. `shell` alone is also sufficient rather than merely necessary, since it can create the HTML file as well as open it. The first cut used `writeFile || editFile`, which was wrong in both directions: it hid the section from a shell-only agent that could do the whole job, and showed it to a writeFile-only agent that would then shell out and fail.
3. **`executeLocalTool`'s PLAN guard became registry-driven.** It was `mode === PLAN && !PLAN_TOOLS.has(tool)`; it now checks the resolved agent's tool set, with MCP tools (`server__tool`) exempt since they are never in a contract set.
4. **Agent files are sorted by filename.** `readdirSync` returns filesystem order, which varies by platform and creation order — caught by the test harness. Agent order is user-visible (Tab cycle, dialog list), so it must be stable across machines.
5. **`allowsBrowserTools` is inferred for user agents** from whether their `tools:` list contains any `browser*`/`server*` entry, so a read-scoped agent can't have nine browser tools appear because the user's global browser flag is on.

### Fixed after the first live UI test

Live terminal testing found the status bar and input-bar border still assuming two modes — in *opposite* directions, so a custom agent rendered as "Build" with Plan's purple border:

- **`status-bar.tsx`** derived its label as `mode === PLAN ? "Plan" : "Build"`, silently labelling every user agent "Build" — switching into one looked like nothing had happened. Now reads `agent.label`.
- **`input-bar.tsx`** picked its border as `mode === BUILD ? primary : planMode`, painting every user agent purple regardless of capability — an agent with `shell` would have looked read-only.
- Both now key off **`agentCanMutate(agent)`** (new, in `shared/agents.ts`): yellow means "this agent can write files or run commands", purple means read-only, for any agent. That is what the accent colour always actually communicated, and deriving it from tools rather than id is what keeps it honest. The same helper replaced the inline three-tool check in the switchMode confirmation gate.
- **Display order is now built-ins first**, separated from dedup precedence: user files are still scanned first so `build.md` *overrides* BUILD, but an override keeps the built-in's slot rather than being appended, so replacing a built-in's definition doesn't also reshuffle where it sits in the Tab cycle.
- **Labels are capitalized** for display (`explorer` → `Explorer`), matching the built-ins. `id` is untouched — it's what `switchMode`, `@`-mentions and persisted metadata match on.

### Agent definitions are sensitive files

Agent files grant capability — `tools:` decides what an agent may call, and `permission:` can waive approval prompts for normal-tier actions. So an agent able to write them can widen its own privileges, or author a brand-new unrestricted agent, and the change persists to the next launch. Writing one is therefore classified **`destructive`**, the same tier as `.env` and `.koincode/config.json`.

That tier choice is the load-bearing part: `destructive` is exactly the tier Decision 6 refuses to let an agent's own `allow` overlay waive. Without it, a self-modifying agent could grant itself `"file:sensitive": "allow"` and the gate would be decorative.

Covered on all three routes:
- `writeFile`/`editFile` — via `.koincode/agents/**` in the sensitive glob patterns.
- `shell` redirects (`echo … > .koincode/agents/x.md`) — via `.koincode/agents` in `SENSITIVE_BASE_NAMES`, which `isSensitiveFileShellCommand` matches as a substring.
- The **global** `~/.koincode/agents/` — via `isKoincodeControlPath`, an absolute-path check. The glob patterns are matched relative to a workspace root and structurally cannot reach the home directory; global definitions are the more dangerous of the two, since they apply to every project on the machine.

Reads are deliberately unaffected — only `writeFile`/`editFile` consult `isSensitivePath`.

### Mid-session reload

Agent files created, edited, or deleted while a session runs are picked up **immediately, everywhere, with no explicit invalidation step at all.** `lib/agents.ts`'s `loadAgents()` is deliberately uncached — every call re-scans `.koincode/agents/` (project and global) from disk. There is no `cache` variable and no `invalidateAgentsCache()` to call at the right moment, because there is nothing to invalidate.

This replaced a first attempt built the opposite way: a process-lifetime module cache plus an explicit `refreshAgents()` trigger fired from specific "safe" points (a dialog's mount effect, later moved to the `/agents` command action). That version set state on `PromptConfigProvider` — an ancestor — as a side effect near a dialog's mount, and crashed OpenTUI's custom reconciler with `Text must be created inside of a text node`. Moving the trigger to fire from the command action instead of the mount effect did not fix it, and the whole mechanism was reverted (see git history around this file for that attempt).

The uncached redesign sidesteps the failure mode rather than diagnosing it further: a `.koincode/agents/` directory is a handful of small markdown files, so re-reading it on every call is cheap enough (confirmed by scratch benchmark, sub-millisecond) that there is no caching problem to solve, and therefore no invalidation-triggered React state update to get wrong:

- **The agents dialog** (`agents-dialog.tsx`) already unmounts when closed and remounts fresh on every `/agents` open (`DialogProvider` renders `null` while closed) — its own `useMemo(() => loadPrimaryAgents(), [])` was already recomputing on every open; only the underlying module cache was stale. Removing that cache alone fixed it, no component change needed.
- **`@` mentions** (`input-bar.tsx`) call `loadSubagents()` fresh on every keystroke already, unmemoized — same story, no component change needed.
- **Tab cycling and the status bar** read `PromptConfigProvider`'s `primaryAgents`, which *was* frozen behind `useMemo(() => loadPrimaryAgents(), [])` — an empty dependency array means "once, for the life of this component instance," and `PromptConfigProvider` is mounted once at the app root and never remounts, so this was the one genuinely frozen spot. Fixed by dropping the `useMemo` wrapper: `primaryAgents` is now a plain call, recomputed on every render. `PromptConfigProvider` only re-renders on its own state changes (Tab press, model switch, incognito toggle) — never on a hot path like chat-input keystrokes — so this is not a performance concern.

No file watcher, no debouncing, no "refresh on open" event wiring anywhere. Verified with a scratch harness: write/edit/delete an agent file between two `loadAgents()` calls with zero invalidation calls in between, and the second call reflects the change every time — including `getAgentLoadWarnings()`, which now does its own independent fresh scan rather than reading a shared `warningsCache` populated by whichever `loadAgents()` call happened to run last.

**Consequence worth knowing (unchanged from the first design):** if the active agent's file is deleted, the next read of `agent` drops it and `resolveAgent` falls back to BUILD mid-session (Decision 10). That is correct, but it visibly changes the status bar without the user switching anything.

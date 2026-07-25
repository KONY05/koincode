# Feature 49: Read Skills Installed via `npx skills add`

## Origin

Original note: watching an opencode tutorial, the presenter downloaded a skill from skills.sh and it landed in a `.agents` folder the agent could pull instructions from — either a global or a project-local one. The note floated the idea of a `/skills` command dialog to show everything the agent has access to.

## Decision: consume the existing `.agents/skills/` convention, build no installer

The skills foundation already exists (Feature 20): `.koincode/skills/` (project) and `~/.koincode/skills/` (global) directories, `SKILL.md` frontmatter, `read_skill`/`write_skill` tools, and every resolved skill already surfaces as a `/`-prefixed command in the command menu (`loadSkillCommands()`, `commands.tsx`) — so the "`/skills` dialog to see what's available" need is already met by typing `/` and reading the merged command list; no separate dialog needed.

What's missing is skill *acquisition* from outside the repo. Feature 20 deliberately deferred building a koincode-specific installer (`koincode install`, Step 7). Researched the real tool the origin note was describing instead of building a competing one: [`vercel-labs/skills`](https://github.com/vercel-labs/skills) (npm package `skills`, run via `npx skills add owner/repo --skill name`) is an actively maintained, cross-agent package manager for Agent Skills. It:

- Installs `SKILL.md` (+ any `scripts/`/`references/`/`assets/`) into `.agents/skills/<name>/` for project scope, or `~/.agents/skills/<name>/` for global scope (`-g` flag) — this is its path for every agent that doesn't have a bespoke integration (Cursor, OpenCode, Codex, Cline, and others), confirmed independently via [anthropics/claude-code#53950](https://github.com/anthropics/claude-code/issues/53950), which reports Claude Code itself doesn't scan this path.
- Writes frontmatter compatible with what KOINCODE already parses: `name` and `description` are the only required fields. KOINCODE's `parseFrontmatter` (`packages/cli/src/lib/skills.ts`) already defaults absent `tools`/`aliases`/`scope` to `[]`/undefined, so a generic skill (no `tools`/`aliases`/`scope` fields at all) loads without any format adapter.
- koincode isn't in the tool's list of 70+ named agents, so it can't be targeted by name — irrelevant to this feature, since KOINCODE only needs to *read* `.agents/skills/`, not be a named install target. A user runs `npx skills add <repo> --skill <name>` (optionally `-g`) themselves — via a normal terminal, or through KOINCODE's own `shell` tool in BUILD mode — and the next skill-manifest load picks the result up.

No install/download code is added to KOINCODE. This feature is exactly one thing: two more directories in the existing scan list.

## Behavior

### Resolution order (highest to lowest priority)

1. `.koincode/skills/` — project-local (unchanged)
2. `~/.koincode/skills/` — global user (unchanged)
3. `.agents/skills/` — project-local, populated by `npx skills add` or manual download
4. `~/.agents/skills/` — global, populated by `npx skills add -g`
5. `packages/cli/src/skills/` — built-in (unchanged)

koincode-native skills win on a name collision, since only they can carry `tools`/`aliases`/`scope`. `.agents/skills/` is strictly additive read surface underneath them, mirroring how `.koincode/skills/` project already beats `.koincode/skills/` global.

### Scope labelling

Skills found under `.agents/skills/` are tagged the same `"project"` / `"global"` scope values as `.koincode/skills/` finds (not a distinct fourth scope) — every existing consumer of `ResolvedSkill.scope` (system prompt injection, command menu description prefix) already handles exactly those three values and needs no change.

### write_skill unaffected

`write_skill` (agent-authored skills) keeps writing to `.koincode/skills/` only. `.agents/skills/` is read-only external input from KOINCODE's perspective — the ecosystem tool owns writing there, and koincode-authored skills need the `tools`/`aliases`/`scope` fields the generic format doesn't have room for.

## Net-new work

1. **`packages/cli/src/lib/skills.ts`** — `loadSkillsManifest()` gains two more `scanSkillsDir()` calls (`.agents/skills` under `process.cwd()`, `.agents/skills` under `homedir()`), inserted into the merge order between the existing global `.koincode/skills` scan and `BUILTIN_SKILLS`, tagged `"project"` / `"global"` respectively.
2. No schema, server changes — `ResolvedSkill`'s shape, dedup logic, and every downstream consumer are already generic over scope and source directory.

### Follow-up: stale in-process cache when a skill is installed externally mid-session

Live-tested by actually running `npx skills add anthropics/skills --skill frontend-design` (landed project-side) and letting it also auto-install its `find-skills` companion skill (landed global-side, `~/.agents/skills/find-skills/`) — confirmed both resolve correctly and carry only `name`/`description` frontmatter, exactly as assumed above. But typing `/skills` in an **already-running** session didn't surface them.

Root cause: `loadSkillsManifest()`'s module-level `cache` (`packages/cli/src/lib/skills.ts`) is populated once and held for the process's lifetime — by design, so re-filtering on every keystroke doesn't re-hit the filesystem. It's only invalidated by `invalidateSkillsCache()`, which until now was called solely from `write_skill`'s own code path. An external process writing into `.agents/skills/` (or `.koincode/skills/`, for that matter) has no way to signal the already-running session to reload.

**Fix (`packages/cli/src/components/command-menu/use-command-menu.ts`):** `handleContentChange` now calls `invalidateSkillsCache()` at the moment the command palette transitions closed → open (guarded on `!showCommandMenu`, not on every keystroke), so opening the palette always re-scans the skill directories from disk first. `getAllCommands()` (`commands.tsx`) already compares the manifest array by reference to decide whether to rebuild the merged command list, so a fresh manifest reference from the invalidated cache correctly triggers a rebuild. Verified end to end: with the two skills installed above, a fresh `getFilteredCommands("skills")` call (simulating a freshly-typed `/skills`) returns `frontend-design`, `find-skills`, `code-review`, `git-commit`, and `init` — all five carrying the `"skills"` alias. `bun run typecheck` clean.

## Explicitly out of scope

- Any koincode-specific install/download command (`koincode install`, etc.) — deferred indefinitely now that the ecosystem tool covers it.
- A dedicated `/skills` browser dialog — the command menu's existing `/`-prefix listing already merges every resolved skill in, regardless of which directory it came from.
- Registering "koincode" as a named agent target inside `vercel-labs/skills` itself — out of this repo's control and unnecessary for read compatibility.

## Package boundaries

Touches `@koincode/cli` only (`packages/cli/src/lib/skills.ts`). No `@koincode/shared`, `@koincode/server`, or `@koincode/database` changes.

## Open questions

None outstanding.

## Status

Implemented.

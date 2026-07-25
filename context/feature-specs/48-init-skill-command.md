# Feature 48: `/init` Skill Command

## Origin

Original note: add a built-in `/init` command that scaffolds an `AGENTS.md` file if one isn't already present, using research of the repo to generate its content, structured the way this project's own `CLAUDE.md` is structured.

## Decision: implemented as a built-in skill, not a custom command

Researched both mechanisms before choosing (`packages/cli/src/components/command-menu/commands.tsx`, `packages/cli/src/lib/skills.ts`):

- **Built-in commands** (`COMMANDS` array in `commands.tsx`) are imperative TS handlers that run directly in the CLI process — opening a dialog, flipping local/global config, or POSTing to a dedicated server endpoint (`/compact`, `/handoff`). They have no generic "let the model read files and decide what to write" capability; that would have to be hand-rolled as a one-shot `generateTextWithFallback` call (the pattern behind session-title/compact/handoff generation, `packages/server/src/routes/sessions.ts`) with no tool loop — the CLI would have to pre-gather every file the model might want, since there's no back-and-forth.
- **Skills** (`BUILTIN_SKILLS` in `packages/cli/src/skills/builtins.ts`, e.g. `code-review`, `git-commit`) are declarative `SKILL.md` files. Invoking one (`ctx.invokeSkill`) just sends `"Execute skill: <name>"` into the normal chat loop, so the model gets the full agentic tool loop — `glob`/`grep`/`readFile`/`listDirectory` to research, `writeFile` to scaffold — for free, gated by the session's PLAN/BUILD mode exactly like any other task.

`/init` is fundamentally "research the repo, then write one file" — that's the skill shape, not the command shape. Implemented as a new `BUILTIN_SKILLS` entry named `init`, which `loadSkillCommands()` automatically turns into the `/init` command with no other wiring needed. This also matches the original note's own phrasing, "built in command skill."

## Behavior

### File target

Operates on the primary workspace root (the directory the session was opened in) — same scope every other root-level mechanism in this codebase uses (e.g. the `AGENTS.md`/`CLAUDE.md` eager-injection tier from Feature 47 checks each root's own top level only, no walk-up). Multi-root sessions are out of scope for v1; the skill only targets the primary root.

### Decision tree

1. **`AGENTS.md` already exists at the root** → tell the user it's already present and stop. Never overwrites without being asked.
2. **`AGENTS.md` absent, `CLAUDE.md` present with real (non-empty, non-whitespace) content** → do not re-research from scratch. Feature 47's eager-injection tier means the model already has this exact content sitting in its own system prompt under "Project Instructions" (the `findInstructionFile` chain resolves `CLAUDE.md` there whenever `AGENTS.md` is missing) — the skill instructions tell the model to reference what it's already seeing rather than issue a redundant `readFile` on a file it can already read from context. Adapt that content into `AGENTS.md`: keep the structure and substance, strip anything tool-specific (references to "Claude Code," Claude-only tool names) so the result reads as tool-agnostic guidance any coding agent can follow. Never modifies `CLAUDE.md` itself — it is a different tool's file and out of scope to touch or regenerate.
3. **Neither exists, or `CLAUDE.md` is present but empty** → fresh research pass: package manifest(s), directory structure, existing docs (README, other `context/*` files if present), representative source files, then draft `AGENTS.md` content from what was actually found — no invented sections.

### Structure to mirror

The generated file should follow the same shape this project's own `CLAUDE.md` uses — a short overview, how the repo/monorepo is organized, the commands to run it, and key architectural/design points worth a future agent knowing up front — adapted to whatever the target repo actually contains, not a copy of KOINCODE's own content.

### Mode handling

Research (`readFile`, `listDirectory`, `glob`, `grep`) only needs PLAN-mode tools. The final write needs `writeFile`, which is BUILD-only. `switchMode` is itself available in PLAN mode (`readOnlyToolContracts`), so a session started in PLAN can research first and switch to BUILD immediately before writing, same as any other skill that needs to cross the PLAN/BUILD boundary — no special-casing needed for `/init`.

## Net-new work

1. **`packages/cli/src/skills/builtins.ts`** — add an `init` entry to `BUILTIN_SKILLS`: `tools: ["readFile", "listDirectory", "glob", "grep", "writeFile", "switchMode"]`, `SKILL.md` content encoding the decision tree above. No alias needed — the skill name `init` already yields the `/init` command directly.
2. No changes required to `commands.tsx`, `filter-commands.ts`, the dialog system, or any server/shared/database package — the skill mechanism already covers command registration, mode gating, and tool execution.

## Explicitly out of scope for v1

- Multi-root targeting (only the primary root is scaffolded).
- Any `--force`/overwrite flag for an existing `AGENTS.md`.
- Touching, regenerating, or syncing `CLAUDE.md` itself.
- A confirmation/preview dialog before writing — matches the existing skill precedent (`code-review`, `git-commit`), which also run straight through the chat loop with no pre-execution gate; the user sees the write happen turn-by-turn like any other BUILD-mode action and can interrupt if unwanted.

## Package boundaries

Touches `@koincode/cli` only (`packages/cli/src/skills/builtins.ts`). No `@koincode/shared`, `@koincode/server`, or `@koincode/database` changes.

## Open questions

None outstanding.

## Status

Spec only — not yet implemented.

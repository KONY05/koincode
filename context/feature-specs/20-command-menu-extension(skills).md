## Skills — Implementation Plan

A skill is a directory under `~/.koincode/skills/` (global) or `.koincode/skills/` (project-local) containing a `SKILL.md` file with structured frontmatter, plus optional `scripts/`, `references/`, and `assets/` subdirectories.

---

### Skill directory structure

```
~/.koincode/skills/
  code-review/
  ├── SKILL.md          # Required
  ├── scripts/          # Optional: executable scripts
  ├── references/       # Optional: context docs
  └── assets/           # Optional: templates, resources

.koincode/skills/       # Project-local (higher priority)
  git-workflow/
  └── SKILL.md
```

Built-in skills ship inside the binary at `packages/cli/src/skills/`.

---

### SKILL.md frontmatter

```yaml
---
name: code-review
description: Review code for bugs, style, and missed edge cases
tools: [readFile, shell]
scope: global        # "global" or "project" — used when agent creates a skill
---

# Instructions

Directive prose written to the agent. Tell it what to do step by step.

## Steps (optional)
Numbered breakdown for multi-stage tasks.

## Notes (optional)
Edge cases, warnings, caveats. Scripts must not use interactive prompts.
Use $SKILL_DIR to reference files within the skill directory.
```

---

### Resolution order (highest to lowest priority)

1. `.koincode/skills/` — project-local
2. `~/.koincode/skills/` — global user
3. `packages/cli/src/skills/` — built-in (bundled)

If a project-local and global skill share the same name, project-local wins and only one entry appears in the manifest.

---

## Implementation steps

### Step 1 — Skill loader (`packages/cli/src/lib/skills.ts`)

New module responsible for scanning all three locations and building the resolved manifest.

- Parse SKILL.md frontmatter using a minimal YAML front-matter parser (no heavy deps)
- For each discovered skill, produce a `ResolvedSkill`:
  ```ts
  type ResolvedSkill = {
    name: string;
    description: string;
    tools: string[];
    scope: "global" | "project" | "builtin";
    skillDir: string;   // absolute resolved path to skill directory
    files: string[];    // relative paths of all files inside the skill dir
  }
  ```
- Export `loadSkillsManifest(): ResolvedSkill[]` — deduplicates by name (first wins per priority order)
- Export `resolveSkill(name: string): ResolvedSkill | null`

---

### Step 2 — System prompt manifest injection

The server builds the system prompt (`packages/server/src/system-prompt.ts`) but skills are local to the CLI. The manifest travels from CLI → server as part of the existing request payload.

**`packages/shared/src/schemas.ts`** — extend `submitSchema` in the chat route with an optional `skillsManifest` field:
```ts
skillsManifest: z.array(z.object({
  name: z.string(),
  description: z.string(),
  scope: z.enum(["global", "project", "builtin"]),
})).optional(),
```

**`packages/server/src/system-prompt.ts`** — when `skillsManifest` is non-empty, append a section:
```
## Available Skills
Invoke read_skill("name") to load a skill's full instructions before using it.

- code-review [project] — Review code for bugs, style, and missed edge cases
- git-workflow [global] — Manage git commit workflows

## Creating a Skill
When asked to create a skill, write a SKILL.md to the correct scope path using write_skill.
SKILL.md structure:
  ---
  name: kebab-case-name
  description: One sentence describing what this skill does
  tools: [list, of, tools]
  scope: global | project
  ---
  # Instructions
  ...directive prose...
Scripts inside scripts/ must not use interactive prompts. Accept all input via
flags or env vars. Use $SKILL_DIR to reference sibling files.
Prefer bunx for JS/TS one-off commands. Prefer structured (JSON) stdout output.
```

**`packages/cli/src/hooks/use-chat.ts`** — call `loadSkillsManifest()` and include it in every chat request.

---

### Step 3 — `read_skill` tool

Available in both PLAN and BUILD mode (read-only).

**`packages/shared/src/schemas.ts`** — add schema:
```ts
readSkill: z.object({
  name: z.string().describe("Skill name to read"),
  file: z.string().optional().describe(
    "Relative path within the skill directory (e.g. 'references/guide.md'). " +
    "Omit to read SKILL.md and get a directory listing."
  ),
}),
```

Add tool contract to `readOnlyToolContracts`.

**`packages/cli/src/tools/read-skill.ts`** — new file:
- Resolve skill via `resolveSkill(name)` — throw if not found
- If `file` is omitted: read `SKILL.md` content + list all files in the skill dir recursively
- If `file` is provided: resolve `path.join(skillDir, file)`, guard against path traversal (must stay inside `skillDir`), return file content
- Return value includes `skillDir` so the agent can construct correct absolute paths for `shell` calls
- Return shape:
  ```ts
  {
    skillDir: string;
    content: string;         // SKILL.md body or requested file content
    files?: string[];        // only when reading SKILL.md (no file arg)
  }
  ```

Add `"readSkill"` to `PLAN_TOOLS` in `packages/cli/src/tools/index.ts` and wire the `case` in the switch.

---

### Step 4 — `write_skill` tool (agent skill creation)

BUILD mode only.

**`packages/shared/src/schemas.ts`** — add schema:
```ts
writeSkill: z.object({
  name: z.string().describe("Kebab-case skill name"),
  content: z.string().describe("Full SKILL.md file content including frontmatter"),
  scope: z.enum(["global", "project"]).describe(
    "Where to save: 'project' for .koincode/skills/, 'global' for ~/.koincode/skills/"
  ),
}),
```

Add tool contract to `buildToolContracts` only (not `readOnlyToolContracts`).

**`packages/cli/src/tools/write-skill.ts`** — new file:
- Resolve target dir: `.koincode/skills/<name>/` or `~/.koincode/skills/<name>/`
- `mkdir -p` the skill directory
- Validate the content has valid frontmatter before writing
- Check if `SKILL.md` already exists to determine create vs. update
- Write `SKILL.md` only — never touch `scripts/`, `references/`, or `assets/`
- Return `{ skillDir, created: boolean }` so the agent can report "created" vs. "updated" to the user

**Updating a skill:** No separate tool needed. The agent calls `read_skill(name)` to get the current `SKILL.md` content, modifies it in context, then calls `write_skill` with the updated content. The existing skill directory structure is preserved.

**Manual editing:** Skills are plain markdown files. Users can edit `SKILL.md` directly in any text editor. Add a note to the system prompt guide: _"Skills are plain markdown files at `~/.koincode/skills/<name>/SKILL.md` and can be edited directly."_

Wire in `packages/cli/src/tools/index.ts`.

---

### Step 5 — Command menu integration

**`packages/cli/src/components/command-menu/types.ts`** — extend `Command` and `CommandContext`:
```ts
export type Command = {
  name: string;
  description: string;
  value: string;
  isSkill?: boolean;
  action?: (ctx: CommandContext) => void | Promise<void>;
};

export type CommandContext = {
  // existing fields ...
  invokeSkill: (skillName: string) => Promise<void>;
};
```

**`packages/cli/src/components/command-menu/commands.tsx`** — add `loadSkillCommands()`:
```ts
export function loadSkillCommands(): Command[] {
  return loadSkillsManifest().map((skill) => ({
    name: skill.name,
    description: `[skill] ${skill.description}`,
    value: `/${skill.name}`,
    isSkill: true,
    action: async (ctx) => {
      await ctx.invokeSkill(skill.name);
    },
  }));
}
```

Merge `COMMANDS` and `loadSkillCommands()` at the usage site so skill commands appear alongside built-in commands.

**`packages/cli/src/components/command-menu/index.tsx`** — pass `invokeSkill` into context from the parent screen.

**`packages/cli/src/screens/session.tsx`** — implement `invokeSkill`:
- Call `read_skill(name)` via the local tool executor to get full SKILL.md content
- Submit it as a user message (or a prefixed system-style message) to trigger an immediate agent turn

---

### Step 6 — Built-in skills

Create `packages/cli/src/skills/` with at least two starter skills:

```
packages/cli/src/skills/
  code-review/
  └── SKILL.md
  git-commit/
  └── SKILL.md
```

Update the skill loader to resolve the bundled path via `import.meta.dir` or a build-time constant.

---

### Step 7 (future) — `koincode install`

Wrap npm install with a naming convention (`@koincode-skills/<name>`) and extract skill files to `~/.koincode/skills/<name>/`. Add to progress tracker, do not implement now.

---

## Files touched

| File | Change |
|---|---|
| `packages/cli/src/lib/skills.ts` | New — skill loader and manifest builder |
| `packages/cli/src/tools/read-skill.ts` | New — `read_skill` tool |
| `packages/cli/src/tools/write-skill.ts` | New — `write_skill` tool |
| `packages/cli/src/tools/index.ts` | Wire new tools + add `readSkill` to PLAN_TOOLS |
| `packages/shared/src/schemas.ts` | Add `readSkill`, `writeSkill` schemas + tool contracts; extend submit payload |
| `packages/server/src/system-prompt.ts` | Inject skills manifest + skill creation guide |
| `packages/server/src/routes/chat.ts` | Accept `skillsManifest` in request |
| `packages/cli/src/hooks/use-chat.ts` | Include `skillsManifest` in every chat request |
| `packages/cli/src/components/command-menu/types.ts` | Add `isSkill`, `invokeSkill` to types |
| `packages/cli/src/components/command-menu/commands.tsx` | Add `loadSkillCommands()` |
| `packages/cli/src/components/command-menu/index.tsx` | Pass `invokeSkill` into context |
| `packages/cli/src/screens/session.tsx` | Implement `invokeSkill` handler |
| `packages/cli/src/skills/` | New — bundled built-in skills |

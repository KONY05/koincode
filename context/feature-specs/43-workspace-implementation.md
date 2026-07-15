when i was trying to work on the integration for the koincode review and koincode i was trying to look for a way to join the 2 or more directories into like a single space so the model will have context of the 2 directories directly at once. i checked and i've seen something like that in ide's like cursor, antigravity, windsurf etc, called "workspaces".

and i was wondering if we could do the same and how it would be implemented

## Decision

Full parity: a session can span a primary root (wherever the CLI was launched) plus one or more additional directories, with the model able to read/write/edit/search and run shell commands against any of them. Added via a new flat `/add-dir` command that opens a lazy, one-level-at-a-time directory picker dialog — no CLI launch flags, no space-separated subcommands (this codebase's command menu has no subcommand parsing; see Design below).

Explicitly cut from v1:
- **No persisted "recently paired directories" convenience.** Considered storing a per-root suggestion cache in `~/.koincode/config.json` so a repeatedly-used pair (e.g. this repo + `KOINCODE-Review`) doesn't need re-adding every session — rejected as unnecessary clutter in a file that's meant for provider keys/preferences, not workspace history.
- **No `/workspace list` or `/workspace remove`.** Only adding a root is in scope; removing one or listing current roots are natural, low-cost follow-ups once `/add-dir` is proven out.

## Design

### Data model — `Session.roots`

`packages/database/prisma/schema.prisma:15-23`'s `Session` model gets a new `roots String @default("[]")` column — a JSON-serialized array of `{ label: string; path: string }`, the primary root always first at index 0. `label` defaults to `basename(path)`; on a basename collision between roots, disambiguate by prefixing the parent directory name.

The existing `cwd String?` column is left untouched (still read for display/filtering in `routes/sessions.ts:35-40,66-78,133-136,363,418`) — `roots[0].path` is always equal to it. `new-session.tsx:49-56` writes both fields at creation: `cwd: process.cwd()` (unchanged) and `roots: JSON.stringify([{ label: basename(process.cwd()), path: process.cwd() }])`.

Because a session's full state (including this) is already reloaded whenever a past session is reopened from Home, this is what makes an added directory "stick" across a restart — no separate resumable "workspace" entity needed.

### Threading roots into the running session

The CLI holds `roots` as session-local state (same lifecycle as `mode`/`model` already have), sent on every chat request body alongside them — `chat.ts:93`'s `submitSchema` gets a new optional `roots` field, mirroring how `skillsManifest` already works (`chat.ts:60-61`). This is deliberate: `buildSystemPrompt` is called fresh on every single request (`chat.ts:250`) reading whatever the client currently sends — the docstring at `system-prompt.ts:33-41` calling the prompt "stable for the life of a session" is about not putting *turn-varying* content in it, not about it being computed once and cached in memory. Adding `roots` as an input needs no special invalidation path; it updates for free on the very next turn, exactly like `skillsManifest` does when a skill is added mid-session.

### System prompt — `getEnvironmentSection`

`system-prompt.ts:89-110` currently hardcodes `**Working Directory**: ${process.cwd()}` at line 106 — this is actually a latent bug independent of this feature: the server is a single long-lived daemon (`server-manager.ts:91-138` spawns it once, inheriting whatever directory it happened to start in), so today every session's system prompt shows the *daemon's* cwd, not necessarily its own. Fixing this is a prerequisite, not a side effect: `SystemPromptParams` (`system-prompt.ts:25-31`) gains a `roots` field, threaded from the new request field through `buildSystemPrompt`'s call site (`chat.ts:250`), and `getEnvironmentSection` lists every root by label + absolute path instead of the one hardcoded line.

### Tool contracts — read/write/edit/glob/list-directory need no schema changes

`resolveFromCwd` (`tools/utils.ts:10-14`) already resolves absolute paths correctly regardless of `process.cwd()` — its own docstring says as much ("Allows absolute and relative paths"). So the *mechanism* for full parity on these five tools already works today; the only gap is that the model doesn't know a second root exists, which the system-prompt change above closes. The one real edit: `packages/shared/src/schemas.ts`'s `.describe()` strings for `readFile`, `writeFile`, `editFile`, `glob`, `listDirectory` (lines 22-33, 42-50) all currently say "Relative path..." — reword to mention that an absolute path is how a secondary workspace root is addressed, since that's the one part of the current tool contract that becomes misleading once there's more than one root.

### Cross-root path display — resolved

`write-file.ts:26,29`, `edit-file.ts:51,54`, and `glob.ts:18` all return `relative(cwd, resolved)`, which for a secondary-root file produces a raw `../KOINCODE-Review/config.ts`-style path. Settled: format it as `<root-label>/<path-relative-to-that-root>` instead (e.g. `koincode-review/config.ts`), falling back to the existing bare-relative form when the file is under the primary root (index 0 — no visible change for the common single-root case) and to the raw absolute path if it's under none of the known roots at all (shouldn't normally happen, but a resolved absolute path is always a safer fallback than a confusing `../../..` chain).

New shared helper in `tools/utils.ts`:

```ts
export function formatWorkspacePath(resolved: string, roots: WorkspaceRoot[]): string {
  for (const [index, root] of roots.entries()) {
    const rel = relative(root.path, resolved);
    if (!rel.startsWith("..")) {
      return index === 0 ? rel : `${root.label}/${rel}`;
    }
  }
  return resolved;
}
```

This needs `roots` to actually reach `write-file.ts`, `edit-file.ts`, and `glob.ts`, which today only receive `input` (see `tools/index.ts:53-137`'s dispatch switch). Threaded the same way `sessionId` already is for `shell`/`serverStart`/`browser*` (`tools/index.ts:44,72,112,121...`): `executeLocalTool` gains a `roots` parameter, passed by its caller in `use-chat.ts` (the same CLI-side session state the chat request body already carries — see above), and forwarded into the three `run*` functions for this one purpose.

### Starting a session already as a workspace

Found during manual testing: a session couldn't start as a workspace at all — `session.tsx`'s auto-submit effect fires the first message immediately on mount, so there was never a window between "session created" and "first message sent" where `/add-dir` could run. Every workspace had to begin single-root, with the second directory added only after the first turn completed.

Fixed by letting `/add-dir` work from the Home screen too, staged locally until the session actually exists:
- `home.tsx` gains `pendingRoots` state (instead of the previous no-op `addWorkspaceRoot`/`workspaceRoots={[]}`) and a real `handleAddWorkspaceRoot`, validated with the same `findRootConflict`/`makeRootLabel` helpers the server route uses (see below) against `[PRIMARY_ROOT, ...pendingRoots]` — `PRIMARY_ROOT` being a module-level `{ label: basename(process.cwd()), path: process.cwd() }`, not the display-shortened `CWD` from `utils/helper.ts`, since this needs a real filesystem path to compare against.
- `workspaceRoots` passed to `SessionActionsProvider` from Home is `[PRIMARY_ROOT, ...pendingRoots]` — the *full* array with primary at index 0, matching the convention every other consumer (mention autocomplete, session footer) already relies on, not just the staged secondary roots on their own.
- On submit, `pendingRoots` rides along in the router `state` (same mechanism `message`/`mode`/`model` already use) into `NewSession`.
- `new-session.tsx`'s `newSessionStateSchema` gained an optional `pendingRoots` field; the `POST /sessions` call now sends `roots: [{ label: basename(cwd), path: cwd }, ...state.pendingRoots]` instead of always just the primary root alone.
- Home's own footer (separate from `session-shell.tsx`'s) gets the same `+N dir` suffix for consistency, shown as soon as a directory is staged.

No new command, no CLI flag — same `/add-dir`, just usable one screen earlier than before.

**Shared helper extracted along the way:** the overlap-conflict check (exact duplicate, new-path-nested-in-existing, existing-nested-in-new-path) was originally inline in `routes/sessions.ts`'s `/:id/add-root` handler. Pulled out to `findRootConflict` in `packages/shared/src/workspace.ts` so Home's client-side staging and the server route use the exact same logic rather than two hand-maintained copies of the same subtle path-boundary check.

### Terminal display also needed the formatted path, not just the model's copy

Found during manual testing: `formatWorkspacePath`'s output was only ever read by the *model* (via the tool-result JSON) — the terminal transcript itself never displayed it. `write-file.tsx`/`edit-file.tsx` both rendered `input.path` (the model's raw, often full-absolute-path argument) regardless of what the tool returned, and `readFile`/`listDirectory` had no dedicated tool-view at all — they fell through a generic fallback (`bot-message.tsx`) that echoes `formatToolArgs(input)` verbatim, with nothing to format at all.

Fixed on both sides:
- `write-file.tsx` and `edit-file.tsx` now prefer `output.path` over `input.path` once the tool has actually run (falling back to the input path while pending or on error, since there's no output yet in either case).
- `read-file.ts` and `list-directory.ts` now take a `roots` parameter and return a `formatWorkspacePath`-formatted `path` in their output too (previously `readFile` returned no path at all; `listDirectory` had the same `relative(cwd, resolved)` bug the other tools originally had). Threaded through `executeLocalTool` the same way as the other three tools.
- New shared `components/tool-view/path-view.tsx` (`PathToolView`) gives `readFile`/`listDirectory` a real dedicated view for the first time, preferring `output.path` the same way — wired into `bot-message.tsx` ahead of the generic fallback.

`glob` and `grep` were checked and left alone: both only ever render a match *count* in the transcript (`— 12 files`), never a path or file list, so there was nothing to fix there — the formatted paths in `glob`'s `output.files` still only matter for the model's own follow-up reasoning.

### Permission gate — attached roots count as "inside project"

Found during manual testing, not in the original design: `readFile`/`writeFile`/`editFile` gate on `isOutsideProject()` (`utils/permissions/file.ts`), which only ever checked the path against `process.cwd()` — so every single tool call touching a secondary root was hitting a `file:outside:...` approval prompt, even though `/add-dir` is already an explicit, one-time trust decision. Fixed by giving `isOutsideProject` (and `isSensitivePath`, for matching sensitive-file glob patterns against whichever root actually contains the path) an optional `roots` parameter — a path only counts as "outside project" if it's outside *every* attached root, not just the primary one. `getPermissionInfo` threads this through from its own new `roots` parameter, supplied at the real gating call site in `use-chat.ts` via the same `_activeRoots` map used elsewhere. Sub-agents (`spawn-agent.ts`'s call site) still get no roots, consistent with them having no session/workspace context anywhere else in this feature — their file tool calls outside the primary root still gate as before.

### Bash — the one tool that needs a real schema change

`toolInputSchemas.shell` (`schemas.ts:51-63`) has no `cwd` field today, and both `Bun.spawn` call sites in `shell.ts` (background: lines 64-69; foreground: lines 137-142) hardcode `cwd: resolveFromCwd(".").resolved` — always the primary root. Unlike file tools, a spawned shell's working directory is a real OS-level property, not something a path string alone can redirect, so this needs an actual new optional `cwd` field (absolute path to one of the workspace roots or a subdirectory of one), resolved the same way at both spawn sites instead of the hardcoded `"."`.

### `/add-dir` command

New flat entry in `commands.tsx`'s `COMMANDS` array. Flat and single-token deliberately, not `/workspace add <path>`: `use-command-menu.ts:44-53` closes the command menu the instant the typed text contains a space, and every existing entry in `COMMANDS` (`new`, `review-connect`, `enable-browser-tools`, etc.) is a self-contained hyphenated string with no subcommand parsing — a space-separated form structurally doesn't fit this menu.

```
{
  name: "add-dir",
  description: "Add another directory to this session's workspace",
  value: "/add-dir",
  action: (ctx) => {
    ctx.dialog.open({
      title: "Add Directory",
      children: <DirectoryPickerDialogContent onSelect={ctx.addWorkspaceRoot} />,
    });
  },
}
```

`addWorkspaceRoot` is a new method threaded through `CommandContext` (`command-menu/types.ts:6-24`) and `SessionActionsContext` (`providers/session-actions/index.tsx:4-9`), implemented in `session.tsx` next to `handleClearSession` the same way `clearSession`/`handoff`/`compact` already are. It:

1. Rejects (toast, no dialog close) if the chosen path is already a root, or is nested inside/contains an existing root.
2. Appends to local `roots` state (so the very next chat request already includes it).
3. Persists via a new `POST /sessions/:id/add-root` route in `routes/sessions.ts`, following the existing action-endpoint convention (`/:id/clear`, `/:id/compact`, `/:id/handoff` at lines 166, 223, 340) rather than a generic PATCH.
4. Toasts success: `Added <label> to this workspace`.

### `DirectoryPickerDialogContent` — new component

New file, `components/dialogs/directory-picker-dialog.tsx`, exported from `dialogs/index.tsx` alongside the other dialog content components.

- **Lazy, one level at a time**: `readdir(currentPath, { withFileTypes: true })`, directories only, on open and again each time the user drills in — never a recursive walk. This can't reuse `getMentionCandidates` (`input-bar.tsx:137-267`) directly despite it being the closest existing lazy-`readdir` pattern, because that function is hard-boundary-checked to never resolve outside the primary root (`isWithinCurrentDirectory` guard, `input-bar.tsx:162-165`) — exactly the constraint this picker needs to not have. It does reuse the same hidden-dotfile filtering and the `RECURSIVE_MENTION_IGNORED_DIRECTORIES` ignore-set for consistency (skip `node_modules`, `.git`, etc.).
- **Starting location**: one level above the primary root (`dirname(primaryRootPath)`) — sibling repos are the common case (per your KOINCODE / KOINCODE-Review example) — with ordinary up/down navigation from there so the user isn't stuck if what they need is further out.
- **List + keyboard nav**: reuses the existing scrollable-selectable-list pattern already used for `FileMentionMenu` (`input-bar.tsx:277-329`) and the slash-command menu — a `<scrollbox>` of rows with selection highlighting and arrow-key nav, not a new list primitive.
- **Row 0 is always pinned**: `Use this directory — <currentPath>` — selecting it confirms and closes the dialog, calling `onSelect(currentPath)`. Remaining rows are subdirectories of `currentPath`; selecting one drills in (reloads children, resets selection to row 0). Backspace/left-arrow goes up a level (no-ops at filesystem root).
- **Search**: a text input at the top filters the *currently loaded* level by substring match only — no cross-level fuzzy search, so every listing stays a single, cheap `readdir` rather than reintroducing the kind of bounded recursive walk `getMentionCandidates`'s fallback path uses. This is my assumption, not yet explicitly confirmed by you — flagged again in Open questions.

### `@`-mention autocomplete across roots

Today, `getMentionCandidates` (`input-bar.tsx:137-267`) can't surface a secondary-root file at all: it hard-rejects absolute-path queries outright (`normalizedQuery.startsWith("/") → return []`, lines 141-143) and hard-boundary-checks everything else to `CURRENT_DIRECTORY` via `isWithinCurrentDirectory` (lines 162-165). Without a fix, `@`-mentioning something in `KOINCODE-Review` while sitting in `KOINCODE` stays impossible through the UI — the model could still be pointed at it via a hand-typed absolute path in a tool call, but the interactive autocomplete affordance wouldn't help find it, which undercuts "full parity" for the one feature people reach for constantly when referencing a file mid-message.

- At the top level (`directoryPart === ""`), each secondary root's `label` gets injected into the candidate list as a synthetic directory entry, sorted alongside the primary root's real subdirectories — so pressing `@` alone already shows e.g. `koincode-review/` as a navigable option.
- Typing into one (`@koincode-review/src/...`) resolves `absoluteDirectory` against that root's real absolute path instead of `resolve(CURRENT_DIRECTORY, directoryPart)`, and skips the `isWithinCurrentDirectory` check for that one branch — safe to skip deliberately here, since the target is one of the session's own explicitly-added roots, not an arbitrary filesystem escape.
- What actually gets inserted into the message on selection is the resolved **absolute path**, not the label-prefixed display string — labels are purely a UI convention (matching `formatWorkspacePath` elsewhere in this spec), and tools already handle absolute paths correctly with no extra translation needed downstream.
- The bounded recursive fallback (`visit()`, lines 215-263, triggered on a ≥2-char prefix with no direct top-level match) needs to run per-root once there's more than one, but the existing `MAX_FALLBACK_MENTION_CANDIDATES` cap stays a shared total across all roots, not per-root — so adding a workspace root doesn't silently make every fuzzy mention search slower or the result list longer than intended.

### Sessions dialog — glance indicator + `workspace` search shortcut

No dedicated tab (a third tab would turn the existing binary `Tab`-toggle in `sessions-dialog.tsx:167-170` between `"project"`/`"all"` into a three-way cycle for something that isn't a location scope like the other two). Instead, two small additions to the existing dialog:

- **Glance indicator**: `renderItem` (`sessions-dialog.tsx:270-293`) grows a dim `+N dirs` badge next to the title whenever `session.roots.length > 1`, same styling as the existing conditional `shortCwd(session.cwd)` badge it already renders for the `"all"` tab.
- **`workspace` search shortcut**: `filterFn` (`sessions-dialog.tsx:269`, passed into the fully generic `DialogSearchList` — `dialog-search-list.tsx:18`) becomes a union: the existing title-substring match, **or** the session has multiple roots when the typed query is exactly `"workspace"` (case-insensitive, exact word — not a prefix match, so typing `"work"` while searching an unrelated title doesn't unexpectedly pull in every multi-root session). Union rather than exclusive, so a session literally titled "workspace setup" still matches on title too — nothing is hidden, `"workspace"` just additionally surfaces every multi-root session regardless of title.

This requires `roots` to actually reach the `Session` type this dialog uses (`InferResponseType<(typeof apiClient.sessions)["$get"], 200>[number]`, from `sessions-dialog.tsx:17`) — today's list endpoint uses an explicit `select: { id, title, updatedAt, cwd }` (`routes/sessions.ts:74-79`) that omits it, so this needs a one-line addition there. Same for session creation: `createSessionSchema` (`routes/sessions.ts:32-37`) and the `.post("/")` handler (`routes/sessions.ts:133-137`, currently `data: { title, cwd, gitBranch }`) both need `roots` added to match what `new-session.tsx` sends, exactly like `cwd`/`gitBranch` already work.

### Info sidebar — Modified Files across roots

Not optional once a second root has real write access: `useModifiedFiles` (`hooks/use-modified-files.ts`) → `getModifiedFiles()` (`lib/git-status.ts`) shells out to git with no explicit `cwd`, so it only ever inherits the CLI process's own `process.cwd()` — the primary root. KOINCODE and KOINCODE-Review are separate git repos, so changes made in a secondary root would silently never appear in the sidebar's "Modified Files" section (`info-sidebar.tsx:94-119`) at all without this fix.

`getModifiedFiles` takes a `roots: WorkspaceRoot[]` param, runs its existing git-status logic once per root (passing each root's absolute path as `cwd` to the underlying `execSync` calls in `git-status.ts`), and merges the results. Entries from a non-primary root get prefixed with the root's label, same `<root-label>/<path>` convention as `formatWorkspacePath` — no change to the primary root's existing bare-path display. `useModifiedFiles` and `InfoSidebar`'s props both need to accept the current `roots` list to pass through.

### Session footer — root count indicator

`session-shell.tsx:218-221` already shows the primary root today (`{CWD}{GIT_BRANCH ? ":"+GIT_BRANCH : ""}`, `CWD` from `utils/helper.ts:4` — `process.cwd()` with home shortened to `~`) — the right home for surfacing additional roots, rather than the separate mode/model status bar (`status-bar.tsx`), which shows no location info today and is already tightly width-budgeted for turn-to-turn state, not fairly static session structure.

Appends a compact `+N dir(s)` suffix when `roots.length > 1` — e.g. `~/Documents/Code/KOINCODE:feat/phase2 +1 dir` — same badge phrasing as the sessions-dialog glance indicator. `CWD`/`GIT_BRANCH` stay exactly as they are (module-level constants, computed once — the primary root never changes), but the count can't be: it needs to update live when `/add-dir` runs mid-session. `SessionShell`'s `Props` (`session-shell.tsx:31-53`) gains an `additionalRootCount` (or full `roots`) field, threaded down from `session.tsx`'s `roots` state the same way `sessionTitle`/`sessionCost` already are.

## Package boundaries

- `packages/database`: `Session.roots` column + migration.
- `packages/server`: `chat.ts` (`submitSchema` gets `roots`, threaded to `buildSystemPrompt`), `system-prompt.ts` (`SystemPromptParams` + `getEnvironmentSection`), `routes/sessions.ts` (new `POST /:id/add-root`; `roots` added to `createSessionSchema`, the `.post("/")` handler, and the `GET /` list `select`).
- `packages/shared`: `schemas.ts` — `.describe()` wording only for `readFile`/`writeFile`/`editFile`/`glob`/`listDirectory`; a real new `cwd` field for `shell`.
- `packages/cli`: `screens/new-session.tsx` (write `roots` at creation, merging in staged `pendingRoots`), `screens/home.tsx` (`pendingRoots` staging state + `handleAddWorkspaceRoot` + footer suffix), `screens/session.tsx` (`roots` state + `addWorkspaceRoot`), `providers/session-actions/index.tsx`, `components/command-menu/types.ts` + `commands.tsx` (new `/add-dir` entry), new `components/dialogs/directory-picker-dialog.tsx` + `dialogs/index.tsx` export, `tools/shell.ts` (cwd-aware spawn at both call sites), `tools/utils.ts` (`formatWorkspacePath`), `tools/read-file.ts` / `tools/write-file.ts` / `tools/edit-file.ts` / `tools/glob.ts` / `tools/list-directory.ts` (use it instead of raw `relative(cwd, resolved)`), `tools/index.ts` + `use-chat.ts` (thread `roots` through `executeLocalTool`), `components/input-bar.tsx` (`getMentionCandidates` across roots), `components/dialogs/sessions-dialog.tsx` (glance badge + `workspace` search shortcut), `lib/git-status.ts` + `hooks/use-modified-files.ts` + `components/info-sidebar.tsx` (multi-root modified files, per-root collapsible sections), `components/session-shell.tsx` (`+N dir` footer suffix), `components/tool-view/write-file.tsx` / `edit-file.tsx` / new `path-view.tsx` (prefer formatted `output.path` over raw model input in the transcript), `utils/permissions/file.ts` + `utils/permissions/index.ts` (attached roots count as "inside project" for approval gating).
- `packages/shared`: also `workspace.ts`'s `findRootConflict`, shared between the server route and Home's client-side staging.

## Suggested implementation order

1. `Session.roots` schema + migration; `new-session.tsx` writes it; `sessions.ts` GET returns it. Verifiable alone: create a session, confirm `roots` round-trips via the API.
2. Thread `roots` through `chat.ts` → `buildSystemPrompt` → `getEnvironmentSection`, server-side only — verify by hand-editing a session's `roots` in the DB and confirming the rendered system prompt lists both paths correctly, before any UI exists for adding one.
3. `DirectoryPickerDialogContent` in isolation — lazy readdir, drill-in/up nav, pinned "use this directory" row, search filter — verifiable by opening it against a real directory tree without it being wired to `/add-dir` yet.
4. `/add-dir` command + `addWorkspaceRoot` + `POST /:id/add-root`, end to end: add a real sibling directory mid-session, confirm the next turn's system prompt reflects it, and the model can read/write a file there via an absolute path.
5. `shell` tool `cwd` param — verify by asking the model to run a command in the secondary root and confirming it actually executed there (e.g. a `pwd` round-trip).
6. `.describe()` wording pass for the five unchanged-schema tools.
7. Sessions dialog: add `roots` to the list `select` + create route, then the glance badge and `workspace` search shortcut — verifiable by creating one single-root and one multi-root session and confirming the badge shows on only the latter, and that searching `workspace` surfaces only the latter regardless of title.
8. Session footer `+N dir` suffix and multi-root Modified Files — verifiable by adding a second root via `/add-dir`, confirming the footer count updates immediately, editing a file in the secondary root, and confirming it shows up in the sidebar's Modified Files list with the correct root-label prefix.
9. `@`-mention autocomplete across roots — verifiable by typing `@` with a workspace attached and confirming the secondary root's label appears as a candidate, drilling into it lists that root's real files, and selecting one inserts its absolute path into the message.

## Open questions / deferred

- **`/workspace remove` / `/workspace list`** — not in v1, see Decision.
- **Recently-used directory pairing** — explicitly dropped per your call; nothing about workspace history gets written to `~/.koincode/config.json`.
- **Root label collisions** — disambiguation rule (parent-dir prefix) stated above but not fully speced; low-stakes enough to nail down at implementation time.

All previously-open questions about picker search scope (current-level substring, confirmed) and cross-root path display (`<root-label>/<relative-path>` formatting, confirmed) are now settled — see Design above.

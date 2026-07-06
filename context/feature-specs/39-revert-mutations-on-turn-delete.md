so what if a user deletes a turn (esc esc / DELETE /:id/messages/last-user) and that turn's agent response wrote or edited a file — should the deletion revert the file mutation too?

## Decision

Yes, but scoped to `writeFile` and `editFile` only. `shell` is excluded — arbitrary commands (installs, git commits, deletes, network calls) aren't safely revertible from a tracked before/after snapshot, so we don't pretend to undo them.

Deletion is already suffix-only (`DELETE /:id/messages/last-user` deletes everything from the last user message onward, per `sessions.ts:194` — never an arbitrary mid-history turn). That matters: it means a mutation being reverted can never have a "later turn" outside the deleted range that also touched the same file — if a later turn touched it, that turn is in the deleted range too. So reverts only ever need to walk backward through a contiguous, fully-known range.

UX split:
- Last turn has no `writeFile`/`editFile` calls → delete immediately, no dialog (current behavior, unchanged).
- Last turn (or any turn in the range being deleted) has one or more of those calls → show a confirm dialog listing the affected files and stating they'll be reverted, before calling the delete endpoint.

## Design

### 1. Snapshot capture (`packages/cli/src/tools/write-file.ts`, `edit-file.ts`)

- `edit-file.ts` already does `readFile` before writing (`content` at line 19) — reuse that as the "before" snapshot, no new read needed.
- `write-file.ts` currently has no pre-write read. Add one: attempt `readFile` before the `writeFile` call; if it throws ENOENT, record "before" as `null` (file didn't exist — revert means delete, not restore-empty).
- Store snapshot content as a content-addressed blob under a new `SNAPSHOTS_DIR` (`packages/shared/src/paths.ts`, sibling to `GLOBAL_CONFIG_DIR`/`DB_PATH`), namespaced per project: `~/.koincode/snapshots/<sha256(cwd)>/<sha256(content)>`. The project subfolder (keyed by a hash of `process.cwd()`, not the raw path — paths can contain characters that aren't safe as directory names) keeps one project's blobs from piling into the same flat pool as every other project ever opened, and lets the orphan sweep (§3) scope its query to just the current project instead of scanning every session globally. Content-addressing within a project dedupes automatically — repeated edits to the same file, or reverting to a state already seen, don't duplicate storage.
- Extend both tools' return value with:
  ```ts
  snapshot: {
    path: string;        // relative path, same as existing `path` field
    beforeHash: string | null; // null = file did not exist before this mutation
    afterHash: string;
  }
  ```
  This flows into the persisted message automatically — `executeLocalTool`'s return value is already what gets attached as the tool part's `output` (`use-chat.ts:533-537`) and persisted as part of the message's JSON content. No DB change needed for capture itself (see §3 for the separate `MessageSnapshot` reference table used only for cleanup).
- Cap snapshot size (skip storing — but still write the file — for content above some threshold, e.g. 2MB) so one giant generated file doesn't bloat `~/.koincode/snapshots/`. A skipped snapshot just means that file can't be auto-reverted later; treat it the same as a hash-mismatch conflict at revert time.

### 2. Revert logic (new `packages/cli/src/lib/revert-mutations.ts`)

Filesystem access is CLI-only per package boundaries (`ai-workflow-rules.md`), so revert must run client-side, not on the server. Given the messages about to be deleted are already loaded in `session.messages`:

1. Collect every `writeFile`/`editFile` tool part with a `snapshot` field from the messages at `order >= lastUserMessage.order`.
2. Group by file path, most recent mutation first (LIFO).
3. For each file, walk backward verifying the hash chain: current on-disk hash must equal the most recent tracked mutation's `afterHash`. If it matches, keep walking back through that file's mutations within the range; if at any point the recorded `afterHash` of one mutation doesn't equal the `beforeHash` recorded by the next-more-recent one, stop — that's an untracked change layered on top (shouldn't happen from our own tools, but guards drift).
4. If the outermost check (current file vs. last tracked `afterHash`) fails, the file was modified externally (hand-edited, or by a process outside tracked tool calls) after the AI's turn — mark that file as a conflict, skip auto-revert for it, surface it distinctly in the dialog.
5. For each non-conflicting file, the actual revert is just: restore the oldest `beforeHash` blob in the range (if `null`, delete the file instead of writing). No need to materialize intermediate states — the hash chain having verified clean means the oldest before-state is the correct target.

### 3. Orphan sweep (`packages/server/src/routes/snapshots.ts`)

Cleanup needs to know which blobs under `SNAPSHOTS_DIR` are still referenced. Originally designed as a dedicated `MessageSnapshot` side table (populated at every message-persistence point in `chat.ts`) to avoid scanning message content — reconsidered mid-implementation: the sweep is throttled to at most once a day, in a local single-user app, so a full `db.message.findMany` + JSON-parse pass is genuinely cheap (well under a second even at tens of thousands of messages) and isn't a hot path. Keeping the table would have meant a schema migration, an extra insert at every message save, and touching three packages instead of two — not worth it for a once-daily background op. Went with the simpler version:

- `GET /snapshots/referenced-hashes?cwd=<path>`: reads only the messages belonging to sessions whose `cwd` matches (`Session.cwd`, already a field — always set for new sessions since `new-session.tsx` passes `process.cwd()` at creation; left `optional()` in the schema purely because old rows predating that field are `null`), JSON-parses their `content`, and reuses `extractSnapshotHashes` (`packages/server/src/lib/message-snapshots.ts`) to pull out every `beforeHash`/`afterHash` still mentioned. Scoping by `cwd` also means a hash from one project's session can never accidentally "protect" — or get confused with — a same-named blob sitting in a different project's snapshot directory.
- CLI side: `readdir` the current project's snapshot subfolder, delete any file whose hash isn't in the returned set.
- Trigger: not on every delete (that only needs to touch the messages actually being deleted/reverted, already loaded client-side — no scan required there). Run the sweep lazily and infrequently instead — on `useChat` mount, throttled to at most once per day *per project* (state file lives alongside that project's own blobs, `<project-dir>/.sweep-state.json`, rather than one shared global throttle file — otherwise sweeping project A today would suppress project B's sweep tomorrow), and only opportunistically — it never forces the server to start just for this.

### 4. UI (`packages/cli/src/screens/session.tsx`)

- Before calling `handleDeleteLastMessage`'s existing DELETE call, run the collection step above.
- No mutations found → call delete immediately, unchanged.
- Mutations found, no conflicts → confirm dialog: "Deleting this will revert changes to `file1.ts`, `file2.ts`. Continue?"
- Mutations found, some conflicts → dialog calls out the conflicting file(s) separately: "`file3.ts` was modified after the AI's edit — its changes will NOT be reverted." so the user isn't misled into thinking everything is undone.
- On confirm: apply reverts via the lib from step 2, then call the existing delete endpoint (unchanged — server side needs no changes at all).

## Package boundaries

Touches `@koincode/cli` (two tool files, new lib file, `session.tsx`, new dialog) and `@koincode/server` (one new read-only route, reusing the existing `Message` table — no schema change). No `@koincode/database` changes at all after the `MessageSnapshot` table was reconsidered and dropped (see §3) — back within the two-package default from `ai-workflow-rules.md`.

## Suggested implementation order (per ai-workflow-rules.md, one verifiable unit at a time)

1. Snapshot capture in `write-file.ts`/`edit-file.ts` + `SNAPSHOTS_DIR` in `paths.ts`. Verifiable alone: run a writeFile/editFile tool call, confirm a blob shows up under `~/.koincode/snapshots/` and the tool output includes `snapshot`.
2. `revert-mutations.ts` collection + hash-chain + revert-apply logic, exercised manually against a saved session's messages.
3. `GET /snapshots/referenced-hashes` + the throttled orphan sweep. Verifiable alone: manually drop an unreferenced file into `SNAPSHOTS_DIR`, confirm the next sweep removes it and leaves referenced ones intact.
4. Wire into `session.tsx`'s delete flow + confirm dialog UI.

## Status

Implemented per this spec — see `progress-tracker.md`'s Feature 39 entry for the file-by-file summary and verification notes.

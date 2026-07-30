Follow-up to a resend bug found in the `esc esc` / `DELETE /:id/messages/last-user` delete-last-message flow (see the `hasAutoSubmittedRef` fix, `screens/session.tsx`): deleting the last message after a chain of errored/no-response turns destroys more than the user intended, because the server silently folds consecutive orphaned user messages into a single row before persisting.

## Current behavior

When a user message gets no assistant reply (an error, or an interrupt where `onFinish` never fires), it's left in the DB as an orphaned `role: "user"` row with nothing after it. If the user then sends another message without an intervening assistant turn, `routes/chat.ts`'s merge loop (`chat.ts:185-195`) detects two consecutive same-role messages and folds them together — the earlier message's `parts` are prepended onto the newer message's `parts`, the newer message's `id`/`metadata` win, and the earlier message's now-redundant standalone DB row is deleted (`staleDbIds`, `chat.ts:218-223`). This is deliberate and necessary: most providers (Anthropic included) reject two consecutive user turns, and silently dropping the earlier text would lose content the user typed.

The problem: this merge is destructive. Once folded, there is exactly one DB row covering both attempts, and `DELETE /:id/messages/last-user` (`sessions.ts:253-281`) always deletes that whole row (`order >= lastUserMessage.order`). So deleting "the last message" after msg1 (errored) → msg2 (errored, merged with msg1) removes *both* — the user loses msg1's content too, even though from their perspective they only asked to delete msg2. This generalizes to any chain length: if three or more consecutive messages error and merge, one delete wipes the entire chain at once.

## Decision

Delete should be a one-layer undo, not a whole-chain wipe. Track merge provenance so a delete can peel off just the most recently merged attempt and restore the row to its pre-merge state — still sitting there as an orphaned, unanswered message, not resent. Deleting again peels back another layer, and so on, until the row represents a single, never-merged message, at which point delete behaves exactly as it does today (full removal).

No schema migration needed — `Message.content` is already an untyped JSON blob; the new provenance data rides inside it as an additional metadata field, the same way `origin`/`backgroundTaskView` already do.

## Design

### 1. `ChatMessageMetadata.mergeHistory` (`packages/shared/src/chat.ts`)

Add:

```ts
mergeHistory?: { id: string; parts: KoincodeUIMessage["parts"] }[];
```

(exact part type TBD at implementation time — `chat.ts` doesn't currently import UI message part types; either import the relevant `ai` type or accept a structurally loose shape, since this package only stores/replays the data and never interprets individual part kinds.)

Semantics: an ordered stack, oldest first, of the row's own full state (`id` + flattened `parts`) as it existed *immediately before* each subsequent merge. Each entry is a complete snapshot, not a diff — popping the last entry and promoting it to be the row's new top-level `id`/`parts` fully reconstructs the pre-merge state with no other bookkeeping.

### 2. Populate it on merge (`packages/server/src/routes/chat.ts:185-195`)

Currently:

```ts
const mergedAwayIds = new Set<string>();
const deduped: KoincodeUIMessage[] = [];
for (const msg of mergedMessages) {
  const prev = deduped[deduped.length - 1];
  if (prev && prev.role === msg.role) {
    mergedAwayIds.add(prev.id);
    deduped[deduped.length - 1] = { ...msg, parts: [...prev.parts, ...msg.parts] };
  } else {
    deduped.push(msg);
  }
}
```

Change the merge branch to also carry forward `prev`'s own history plus a snapshot of `prev` itself:

```ts
const prevHistory = (prev.metadata as ChatMessageMetadata | undefined)?.mergeHistory ?? [];
deduped[deduped.length - 1] = {
  ...msg,
  parts: [...prev.parts, ...msg.parts],
  metadata: {
    ...msg.metadata,
    mergeHistory: [...prevHistory, { id: prev.id, parts: prev.parts }],
  },
};
```

The flattened `parts` sent onward to `convertToModelMessages`/persistence is unchanged — this only adds a parallel field for later reconstruction, so the model-facing behavior of this code path is identical to today.

### 3. Peel back one layer on delete (`packages/server/src/routes/sessions.ts:253-281`)

Currently the endpoint unconditionally deletes every message with `order >= lastUserMessage.order`. New logic:

1. Parse `lastUserMessage.content`, read `metadata.mergeHistory`.
2. **Empty/missing** (base case — a single, never-merged orphaned message): current behavior, unchanged — delete everything from `lastUserMessage.order` onward.
3. **Non-empty**: pop the last entry (`restored`). Delete anything strictly *after* `lastUserMessage.order` (symmetry with today's suffix-delete; in practice nothing should exist there for an orphaned turn, but stay consistent rather than assume). `UPDATE` (not delete) the `lastUserMessage` row's `content` to `{ ...parsed, id: restored.id, parts: restored.parts, metadata: { ...parsed.metadata, mergeHistory: remaining.length > 0 ? remaining : undefined } }`, where `remaining = mergeHistory.slice(0, -1)`. The DB row's own primary key (`Message.id`, the cuid) and `order` are untouched — only `content` changes.

Both branches stay inside the existing `db.$transaction([...])`.

### 4. Client (`packages/cli/src/screens/session.tsx`)

No changes required. `handleDeleteLastMessage` already refetches the session and force-remounts `SessionChat` after any delete — the remount's `initialMessages` will simply reflect whatever the server now returns (either the fully-deleted state or the restored single-attempt message), so the restored orphaned message will just show up in the transcript as it did before it was ever merged. The `hasAutoSubmittedRef` fix already shipped stays necessary as-is for the true base case (deleting a never-merged message down to zero total messages) — this spec's change actually makes that scenario *less* common, since most deletes will now leave at least the restored prior attempt behind instead of hitting zero.

`initiateDelete`'s mutation-revert check (`collectMutations`/`planRevert`, spec `39-revert-mutations-on-turn-delete.md`) is unaffected: it only ever inspects the range being deleted for `writeFile`/`editFile` tool parts, and an orphaned, never-answered user message by definition has no assistant turn and thus no tool calls in that range — the revert-confirm dialog will not trigger for this flow, same as today.

## Package boundaries

Touches `@koincode/shared` (one new optional metadata field) and `@koincode/server` (the merge loop and the delete endpoint). No `@koincode/cli` changes, no `@koincode/database` schema change or migration.

## Incognito mode

Incognito sessions (`50-incognito-mode-implementation.md`) never hit this code path — `routes/chat.ts` branches around the entire DB-read/merge/pre-save block for `incognito: true` requests, and `deleteLastUserTurn` (client-only, truncates `chat.messages` directly via `chat.setMessages`) has no concept of server-side merging.

This was flagged as an open question and initially assumed benign after one live test happened not to trigger it, but tracing the actual `ai` SDK source (`node_modules/ai/dist/index.mjs`) showed it's a real gap, not a non-issue:

- `AbstractChat.makeRequest` only pushes an assistant placeholder into `chat.messages` once the first stream chunk arrives (inside its `write()` callback). Interrupt before any token streams — the common case for a fast double-interrupt — and no assistant entry is ever created, so `chat.messages` ends with two adjacent `role: "user"` entries.
- `prepareSendMessagesRequest`'s incognito branch sent that array as-is.
- `convertToModelMessages` emits one API-level message per UIMessage with no coalescing of adjacent same-role entries — confirmed by reading its source directly, not assumed.

So two adjacent user turns really would reach the provider unmerged, hitting the same rejection this spec's server-side merge exists to prevent (see "Current behavior" above). Fixed in `packages/cli/src/hooks/use-chat.ts`'s `prepareSendMessagesRequest`: the incognito branch now folds consecutive same-role messages for the outgoing request payload only — mirroring `chat.ts`'s merge loop, minus `mergeHistory` tracking (not needed here, since `chat.messages` itself is left untouched and still holds every individual attempt, so `deleteLastUserTurn` can already peel back exactly one turn with no undo bookkeeping required).

## Suggested implementation order (per `ai-workflow-rules.md`, one verifiable unit at a time)

1. Add `mergeHistory` to `ChatMessageMetadata` — no behavior change alone, verify `bun run typecheck` clean.
2. Populate `mergeHistory` in the merge loop (`chat.ts`) — verify by inspecting a merged row's persisted `content` after reproducing the errored-msg1-then-msg2 scenario; confirm the flattened `parts` sent to the model is unchanged from today.
3. Peel-back logic in the DELETE endpoint (`sessions.ts`) — verify both branches: a single never-merged orphaned message still fully deletes (regression check against current behavior), and a merged (msg1+msg2) row restores to msg1 alone instead of disappearing entirely.
4. Manual end-to-end pass matching this conversation's exact repro: msg1 errors, msg2 errors (merges with msg1), delete → transcript shows msg1 alone, unanswered, not resent (confirms this change and the already-shipped `hasAutoSubmittedRef` fix compose correctly), then send msg3 and confirm the model sees msg1 + msg3 as expected.

## Status

Implemented — normal-mode steps 1–3 as designed (no client changes needed there, as anticipated), plus the incognito-mode client-side fold above.

Verified normal mode: the merge loop's flattened `parts` — the only thing the model ever sees — is byte-identical to before, `validateUIMessages` passes the new `mergeHistory` metadata through untouched (the one real risk; had it been stripped, the fix would have silently no-opped), and one delete against a merged msg1+msg2 row restores msg1 alone with the `mergeHistory` key gone, so the next delete correctly falls through to the base case. Chain traced for arbitrary depth: each delete peels exactly one attempt. Confirmed live by the user against the real double-interrupt repro.

Verified incognito mode: `bun run typecheck` clean, plus a scratch harness confirming `chat.messages` (local UI state, used for the transcript and `deleteLastUserTurn`) is left untouched while the outgoing wire payload correctly folds any run of consecutive same-role messages — both the two-message case (after a delete) and a longer 3-in-a-row chain.

Not verified live in-agent: the end-to-end normal-mode repro (step 4 above) and the incognito fold both need a real TTY session with a strict provider (e.g. Anthropic) to confirm against an actual rejection, not just the request shape.

# Feature 21 — Context Management (`/context` + `/compact`)

## Goal

Add two commands so users can see and control how much of the model's context window is consumed:

- **`/context`** — open a modal showing current token usage vs. the model's context window
- **`/compact`** — summarize the conversation and reset the AI's context window, keeping the visible transcript intact

A segmented ring indicator appears in the status bar when usage reaches 80 %.

---

## Implementation Plan

### 1. Model context windows — `packages/shared/src/models.ts`

Add `contextWindow: number` (token count) to `SupportedChatModelDefinition`.  
Add all values per model (200k for Claude, 1M for Gemini/GPT-4.1, 128k for others).  
Export a `getContextWindow(modelId: string): number` helper that returns 128 000 for unknown / local models.

`ChatMessageMetadata.usage` already exists in `packages/shared/src/chat.ts` (type from AI SDK's `LanguageModelUsage`) and the server already sends it on the finish part — no schema changes needed.

### 2. Server compact endpoint — `packages/server/src/routes/sessions.ts`

Add `POST /:id/compact`:
1. Fetch session + all message records.
2. Find last boundary (`clear_boundary` or `compact_boundary`); slice only messages since that boundary.
3. If fewer than 3 assistant messages → skip summarization, still write the boundary.
4. Extract model from last assistant message metadata.
5. Build a plain-text transcript (same approach as `/handoff`).
6. Call AI to generate a structured summary (goal, actions taken, decisions, open items, next step).
7. Insert `compact_boundary` marker row.
8. Insert a synthetic user+assistant message pair carrying the summary so the AI has it as the first context entry after the boundary.
9. Return `{ summary: string }`.

### 3. Chat route boundary — `packages/server/src/routes/chat.ts`

Update the boundary-scan loop to treat **both** `clear_boundary` and `compact_boundary` as slice points.

### 4. `useChat` hook — `packages/cli/src/hooks/use-chat.ts`

Add `contextUsage` to the hook's return value:
```ts
type ContextUsage = { tokensUsed: number; contextWindow: number; percent: number };
```
Derived with `useMemo` from `chat.messages` — find the last assistant message whose `metadata.usage` is set, read `promptTokens`, look up `getContextWindow(model)`.

### 5. Status bar ring — `packages/cli/src/components/status-bar.tsx`

Accept an optional `contextUsage` prop.  
When `percent >= 80`, render a 10-segment dot ring (`●●●●●●●●○○`) + percentage:
- yellow at 80–94 %
- red at 95 %+

Only shown when there is usage data and the threshold is met.

### 6. Context dialog — `packages/cli/src/components/dialogs/context-dialog.tsx` (new)

Props: `contextUsage: ContextUsage | null`, `model: string`.  
Renders:
- Model name + `Xk context window`
- `Used: X,XXX / Y,YYY (Z%)`
- A 30-char block bar (`█` / `░`)
- `Free: X,XXX tokens`
- If no usage data yet: "No messages sent yet"

### 7. Command context + wiring

Thread through the component tree:

| Layer | Change |
|---|---|
| `command-menu/types.ts` | Add `compact: () => Promise<void>`, `contextUsage`, `model` to `CommandContext` |
| `session-shell.tsx` | Add `onCompact?: () => Promise<void>`, `contextUsage?` props; pass both to `InputBar` |
| `input-bar.tsx` | Accept both props; pass `contextUsage` to `StatusBar`; pass `onCompact` to command context |
| `screens/session.tsx` | Create `handleCompact`, pass `contextUsage` from `useChat` |

### 8. Commands — `packages/cli/src/components/command-menu/commands.tsx`

Add `/context`: opens `ContextDialogContent` with current usage.  
Add `/compact`: calls `ctx.compact()`, which:
1. Shows toast "Compacting context…"
2. Calls `POST /sessions/:id/compact`
3. Adds system event "Context compacted — history summarized, context window reset"
4. Shows toast success/error

---

## UI Behavior

### After `/compact`
- Old messages **remain visible** in the transcript (no hiding like `/clear`)
- A `SystemMessage` divider "Context compacted" appears at the point of compaction
- The AI's next turn starts from the summary + new messages only

### After `/clear`
- Old messages are **hidden** from the transcript (existing behavior, unchanged)

### 9. Auto-compaction — `packages/cli/src/screens/session.tsx`

When a response finishes and `contextUsage.percent >= 90`, automatically trigger `handleCompact` without user action.  
A `useEffect` watches `contextUsage` and fires once per threshold crossing:
- Tracks whether compaction was triggered for the current "high-usage window" with a ref.
- Shows toast "Context window at 90% — auto-compacting…" before compacting.
- Resets the "triggered" flag after a successful compact so future crossings can fire again.

---

## Open Questions (resolved)

- **After compaction, do we keep old messages visible?** Yes — same visual pattern as a system event divider, but messages stay in view. The AI context is reset server-side; the user can still scroll back through the full history.
- **Context bar detail level?** Single bar (accurate) — total `promptTokens` from last API response vs. model context window.

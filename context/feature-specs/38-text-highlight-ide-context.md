# Feature Spec 38 — Text Highlight (Selection) IDE Context

## Goal

Let users highlight/select a range of code in their editor and have KOINCODE pick it up automatically — showing a "N lines selected" indicator in the status bar and injecting the selected code into the next message sent, the same way Claude Code's VSCode extension surfaces a selection chip in its chat input. This extends [Feature 29 — IDE File Awareness](./29-ide-file-awareness.md), which explicitly scoped out prompt injection; this spec is where that gap gets closed, for selections specifically.

## Motivation

Users often highlight the exact block of code they're asking about before switching to the terminal to prompt KOINCODE. Today that intent is lost — they either paste the code manually or describe it in prose and hope the agent finds the right lines. Auto-capturing the selection removes that friction and disambiguates "this" in messages like "refactor this to use async/await."

## Behaviour Model

Chosen deliberately as a hybrid of the two options considered:

- **Ambient capture**: like active-file context, the extension captures the selection continuously — no explicit "attach" keypress required.
- **Visible + one-shot consumption**: unlike active-file context (which re-injects on every turn while enabled), a selection is shown as an indicator and is injected **once**, into the very next message sent. After that message is sent, it's consumed and the indicator clears. Making a new selection (or changing the existing one) makes it available again.

This avoids two bad outcomes: silently re-sending a stale selection on every subsequent turn (noisy, and wrong once the conversation moves on), and requiring a hotkey before every use (friction the user didn't ask for).

## Three-part Architecture

### Part A: VSCode Extension (`packages/vscode-extension/src/extension.ts`)

Add a second listener alongside the existing `onDidChangeActiveTextEditor` one:

```ts
vscode.window.onDidChangeTextEditorSelection((e) => {
  if (e.textEditor !== vscode.window.activeTextEditor) return; // ignore inactive panes
  writeSelection(e.textEditor);
});
```

`writeSelection`:
- If `editor.selection.isEmpty` (plain cursor, no range) → write `selection: null`.
- Otherwise capture:
  - `file`: `editor.document.fileName` (absolute path, same convention as `activeFile`)
  - `startLine` / `endLine`: `editor.selection.start.line + 1` / `editor.selection.end.line + 1` (1-indexed, matches editor gutter)
  - `text`: `editor.document.getText(editor.selection)`, truncated to a hard cap (~20,000 chars) with a `"...truncated"` marker appended if cut, so a huge selection can't blow up the request body.
- Only the primary selection (`editor.selection`) is captured — multi-cursor selections are out of scope (see below).
- `deactivate()` also writes `selection: null`, matching the existing `activeFile: null` cleanup.

Extend the JSON file shape (still a single file, `~/.koincode/ide-context.json`):

```json
{
  "activeFile": "/absolute/path/to/file.ts",
  "selection": {
    "file": "/absolute/path/to/file.ts",
    "startLine": 12,
    "endLine": 18,
    "text": "function foo() {\n  ...\n}"
  }
}
```

`selection` is `null` when there is no active range selection.

### Part B: CLI (`packages/cli/`)

`hooks/use-ide-context.ts`:
- Extend the parsed `IdeContext` type with `selection: { file: string; startLine: number; endLine: number; text: string } | null`.
- Add module-level state `_selection` (mirrors `_activeFile`) and `_selectionEnabled` (mirrors `_enabled`), plus a small `Set<() => void>` of subscriber callbacks — needed because consumption happens from `use-chat.ts` (outside React) but the status bar's React state needs to clear when that happens.
- `getIdeSelectionForRequest()`: **side-effecting** getter. Returns the current selection (or `null` if disabled/absent), and if it returns non-null, clears `_selection` to `null` and notifies subscribers so the UI drops the indicator. This is the "consume once" mechanic.
- `useIdeContext()` gains `selection`, `selectionContextEnabled`, `toggleSelectionContext` in its return value, following the same shape as the existing `activeFile`/`fileContextEnabled`/`toggleFileContext` fields. The hook subscribes to the notifier set in its effect so it re-renders when `use-chat` consumes the selection.

`hooks/use-chat.ts`:
- At the same point `ideActiveFile: getIdeContextForRequest()` is added to the request body (line ~200), add `ideSelection: getIdeSelectionForRequest()`.
- Call this once per submit, not per render — it mutates module state.

`components/status-bar.tsx`:
- Accept `selection` prop; when present, render an indicator in place of the `In <filename>` text, e.g. `3 lines selected · file.ts:12-18`, dim.
- The selection indicator **replaces** `In <filename>` while a selection exists (it already names the file, so showing both is redundant); once the selection clears, `In <filename>` reappears.

`components/input-bar.tsx`:
- Pass `selection`, `selectionContextEnabled` down from `useIdeContext()` to `StatusBar`, same wiring as `activeFile` today.

### Part C: Server (`packages/server/src/`)

`routes/chat.ts`:
- Extend the inline `submitSchema` (line ~62, alongside `ideActiveFile`) with:
  ```ts
  ideSelection: z
    .object({
      file: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      text: z.string(),
    })
    .nullable()
    .optional(),
  ```
- Destructure `ideSelection` alongside `ideActiveFile` (line ~84).
- After `appendIdeContext(...)` (line ~245), pipe the result through a new `appendSelectionContext(messages, ideSelection ?? null)` before `withHistoryCacheControl` (line ~250). Same message (not a second one) gets both blocks appended if both are present.

`lib/prompt-caching.ts`:
- Add `appendSelectionContext`, mirroring `appendIdeContext`'s shape and rationale (attach to the last user/assistant message, never the system prompt, for the same Anthropic cache-breakpoint reasons documented at lines 20-33):

  ```ts
  export function appendSelectionContext(
    messages: ModelMessage[],
    selection: { file: string; startLine: number; endLine: number; text: string } | null,
  ): ModelMessage[] {
    if (!selection || messages.length === 0) return messages;

    const lastIndex = messages.length - 1;
    const last = messages[lastIndex]!;
    if (last.role !== "user" && last.role !== "assistant") return messages;

    const contextText =
      `# Selected Code\nThe user highlighted lines ${selection.startLine}-${selection.endLine} ` +
      `in **${selection.file}**:\n\n\`\`\`\n${selection.text}\n\`\`\`\n\n` +
      `Treat this as the specific code their message refers to, unless the message clearly points elsewhere.`;

    // ...same string/array content-append logic as appendIdeContext
  }
  ```

## Files Changed

| File | Change |
|---|---|
| `packages/vscode-extension/src/extension.ts` | Add `onDidChangeTextEditorSelection` listener; extend written JSON with `selection`; clear on deactivate |
| `packages/cli/src/hooks/use-ide-context.ts` | Extend `IdeContext` type; add selection module state, consuming getter, subscriber notification, toggle |
| `packages/cli/src/hooks/use-chat.ts` | Read `getIdeSelectionForRequest()` at submit time, add `ideSelection` to POST body |
| `packages/cli/src/components/status-bar.tsx` | Render selection indicator, replacing active-file text while a selection exists |
| `packages/cli/src/components/input-bar.tsx` | Wire `selection`/`selectionContextEnabled` from `useIdeContext()` to `StatusBar` |
| `packages/server/src/routes/chat.ts` | Add `ideSelection` to `submitSchema`; destructure; call `appendSelectionContext` |
| `packages/server/src/lib/prompt-caching.ts` | Add `appendSelectionContext` |

Matches the existing package-boundary rule (CLI: capture + display; server: injection) but touches three packages because the underlying mechanism (extension → CLI → server) already does. Per `ai-workflow-rules.md`, split the implementation into separate steps along these lines:
1. Extension + `ide-context.json` schema (Part A)
2. CLI capture, status bar indicator, toggle (Part B)
3. Server-side injection (Part C) — depends on Part B shipping the `ideSelection` field first

## Behaviour

- No selection in the editor: no indicator, nothing injected.
- User highlights a range: status bar shows `N lines selected · file.ts:12-18` within ~1 second (next `fs.watch` tick).
- User sends a message while the indicator is showing: the selected code is appended to that message (server-side, as a `# Selected Code` block), then the indicator disappears immediately.
- User selects again after sending: indicator reappears, available for the next message.
- User deselects (collapses selection back to a cursor) without sending: indicator disappears, nothing to inject.
- Toggling selection context off (mirroring the file-context toggle) suppresses both the indicator and injection, without affecting active-file context.
- Works only inside a VSCode-family integrated terminal (`TERM_PROGRAM === "vscode"`), same gate as active-file context.

## Out of Scope

- Multi-cursor / multiple simultaneous selections — only the primary selection is captured.
- Selections in non-file editors (diff views, output/debug panels, untitled buffers) — not explicitly filtered out in this pass, but not a supported/tested case.
- JetBrains / other IDE support (different IPC mechanism, same limitation as Feature 29).
- An explicit "attach" keybinding — the hybrid ambient/one-shot model above replaces the need for one.
- Persisting a selection across CLI restarts — it's in-memory/module-level state, same lifetime as active-file context.

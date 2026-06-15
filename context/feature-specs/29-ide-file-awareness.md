# Feature Spec 29 — IDE File Awareness

## Goal

Show the currently open file from the user's IDE in the KOINCODE status bar, mirroring the "In models.ts" indicator seen in Claude Code's VSCode extension. This gives users a quick visual confirmation of which file their IDE has focused, without requiring them to switch windows.

## Motivation

When KOINCODE runs inside a VSCode integrated terminal, users often have a file open in the editor they are discussing or asking the agent to modify. Surfacing that file name in the status bar closes the gap between the editor context and the agent context, and makes it easier for users to reference files in prompts (they can see the name at a glance).

## Two-part Architecture

The feature spans two separate processes, which is unavoidable — the `vscode` API only exists inside the VSCode extension host, never in a terminal process.

### Part A: VSCode Extension (`packages/vscode-extension/`)

A minimal VSCode extension that:
1. Activates on startup (`onStartupFinished`).
2. Writes `~/.koincode/ide-context.json` with the currently active editor's file path whenever it changes.
3. Clears the file (sets `activeFile: null`) when the last editor is closed.

Protocol: a single JSON file at `~/.koincode/ide-context.json`:
```json
{ "activeFile": "/absolute/path/to/file.ts" }
```

### Part B: CLI hook + status bar (`packages/cli/`)

`hooks/use-ide-context.ts`:
- Only activates when `TERM_PROGRAM === "vscode"` (confirms we're in the VSCode integrated terminal).
- Reads `~/.koincode/ide-context.json` on mount.
- Watches the `~/.koincode/` directory for changes to `ide-context.json` using `fs.watch`.
- Returns the basename of the active file, or `null`.

`components/status-bar.tsx`:
- Receives `activeFile?: string | null`.
- Renders `In <filename>` dim on the right side, left of the context ring (if visible).

`components/input-bar.tsx`:
- Calls `useIdeContext()` and passes result as `activeFile` to `StatusBar`.

## Files Changed

| File | Change |
|---|---|
| `packages/shared/src/paths.ts` | Add `IDE_CONTEXT_FILE` constant |
| `packages/cli/src/hooks/use-ide-context.ts` | New — IDE context watcher hook |
| `packages/cli/src/components/status-bar.tsx` | Accept + render `activeFile` prop |
| `packages/cli/src/components/input-bar.tsx` | Consume `useIdeContext`, pass to StatusBar |
| `packages/vscode-extension/package.json` | New — VSCode extension manifest |
| `packages/vscode-extension/tsconfig.json` | New — TypeScript config for extension |
| `packages/vscode-extension/src/extension.ts` | New — activate/deactivate, file watcher |

## Behaviour

- When KOINCODE is NOT running inside VSCode: nothing changes, the hook returns null immediately.
- When running inside VSCode but no file is open: nothing shown.
- When running inside VSCode with a file open: `In filename.ts` appears dim on the right of the status bar.
- When the active file changes in VSCode: status bar updates within ~1 second (next `fs.watch` tick).
- Context ring (≥80%) still appears to the right of the file label.

## Out of Scope

- JetBrains / other IDE support (different IPC mechanism).
- Injecting the active file path automatically into the user's prompt.
- Publishing the extension to the VSCode Marketplace (manual install for now).

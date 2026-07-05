## Decision

Terminal bell only, and only when the terminal window is not focused. Rejected alternatives:

- **Title-bar marker** — too low-visibility; users rarely look at the tab/title bar.
- **OS-native desktop notification** (osascript/notify-send) — too aggressive/disruptive for a background dev tool.

On by default (most useful when discovered passively), with a `/notifications` command to toggle it off.

## Design

- **Focus detection**: DEC private mode 1004 (focus reporting). Enabled once at startup via `process.stdout.write("\x1b[?1004h")` in `packages/cli/src/index.tsx`, disabled on shutdown (`\x1b[?1004l`). The terminal then sends `\x1b[I` (focus in) / `\x1b[O` (focus out) on stdin.
- These sequences aren't a key or mouse event, so OpenTUI's stdin parser would otherwise drop them as unrecognized input. Registered as a `prependInputHandlers` entry (`CliRendererConfig.prependInputHandlers`) at `createCliRenderer(...)` call time.
- State lives in `packages/cli/src/lib/terminal-focus.ts` — a plain module-level boolean (`isTerminalFocused()`), not React state, since only `use-chat.ts` needs to read it imperatively at the moment a bell might fire; no component re-renders on focus change.
- **Trigger points** — anywhere the agent starts waiting on the user, in `packages/cli/src/hooks/use-chat.ts`:
  - `chat.status` transitions `streaming`/`submitted` → `ready` with nothing queued to auto-send (plain turn completion). Guarded by a `prevStatusRef` so it doesn't fire on mount/session-resume when `status` is already `"ready"`.
  - `setPendingUserQuestion(...)` (askUser tool)
  - `setPendingModeSwitch(...)` (PLAN→BUILD confirm)
  - `setPendingApproval(...)` (both the MCP approval gate and the general tool-permission gate)
- **Config**: `notificationEnabled?: boolean` on `KoincodeGlobalConfig` (`packages/shared/src/config.ts`), default `true` when unset. Persisted via `updateGlobalConfig` at `~/.koincode/config.json`, same as other feature toggles.
- **Toggle**: `/notifications` command in the command menu (`packages/cli/src/components/command-menu/commands.tsx`), mirrors the existing `/enable-browser-tools` toggle pattern — reads/writes config directly, shows a toast confirming the new state.

## VS Code-family fallback (v1)

Discovered via manual testing (Antigravity, a VS Code fork): `printf '\a'` produced nothing — VS Code's integrated terminal ignores BEL entirely unless the user opts into a bell setting. Since koincode already ships a bundled editor extension for IDE file awareness (`packages/vscode-extension`, auto-installed into known editor extension folders including Antigravity's by `packages/cli/src/lib/ide-extension.ts`), extended it to relay notifications too rather than silently failing for that whole user population:

- `packages/cli/src/lib/vscode-notify.ts` — `notifyVsCode(message)`, gated on `TERM_PROGRAM === "vscode"`, writes `{ message, at: Date.now() }` to `NOTIFY_REQUEST_FILE` (`~/.koincode/notify-request.json`, added to `packages/shared/src/paths.ts`).
- `packages/vscode-extension/src/extension.ts` — now also `fs.watch`es `~/.koincode/` for `notify-request.json` and relays it. Tracks `lastNotifiedAt` (initialized to activation time) so a stale leftover file from a previous session never replays on startup.
- The embedded copy of the extension that actually ships (`packages/cli/src/lib/ide-extension-assets.ts`'s `EXTENSION_JS`/`EXTENSION_VERSION` string constants — this is what gets extracted to disk and installed, not `packages/vscode-extension/`'s own build output) was hand-updated to match, since `packages/vscode-extension`'s own `tsc -p tsconfig.json` build script is actually a no-op (`noEmit: true` inherited from `tsconfig.base.json`, never overridden) — a pre-existing gap in that package, not introduced here.

## VS Code-family fallback (v2 — attempted native OS banner, abandoned)

Testing v1 live in Antigravity surfaced two problems:

1. **`vscode.window.showInformationMessage` never reaches you outside the editor.** It's an in-app toast only — no dock badge, no Notification Center entry. Tabbing away to a different app entirely (the actual original complaint) meant seeing nothing. A literal dock badge (what the user actually asked for, WhatsApp-style) isn't reachable from an extension at all — that's owned by the host app's (Antigravity's) own Electron main process, with no exposed VS Code API for it. Confirmed infeasible and ruled out rather than half-built.
2. **The notification never even fired.** `ringBellIfUnfocused` was gating the VS Code write on the same `isTerminalFocused()` check used for the native-terminal BEL path, on the assumption that Antigravity might not forward DEC 1004 focus-report escapes to the shell.

Attempted fix: skip the CLI's own focus check for `TERM_PROGRAM === "vscode"` and always call `notifyVsCode(...)`, handing the focus decision to the extension via VS Code's own `vscode.window.state.focused`. In `extension.ts`: toast if `state.focused` true, else shell out via `execFile("osascript", ["-e", script])` to `display notification` for a real macOS banner.

**This introduced a regression, caught via debug logging** (temporary `logNotifyDebug`/`logExtDebug`, appending to `~/.koincode/notify-debug.log`, added specifically to stop guessing and get ground truth): the log showed `isTerminalFocused()` correctly reporting `true` while the user was genuinely looking at the terminal panel — meaning DEC 1004 *does* work fine in Antigravity, and the "might not forward it" assumption behind the v2 fix was simply wrong. Skipping that check meant a notification fired on *every single turn*, focused or not. Restored the `isTerminalFocused()` gate for the VS Code path too (same condition as BEL), fixing the spam while keeping `state.focused` as a second, finer-grained signal inside the extension (toast if still in the app, banner attempt if fully backgrounded).

With that fixed, the osascript banner itself still never appeared — logging confirmed `osascript` exits with no error (`error=none stdout="" stderr=""`), and there's no "Script Editor" entry in System Settings > Notifications at all (the identity old macOS versions used for AppleScript-triggered notifications). This is a known modern-macOS limitation: bare `osascript -e 'display notification'` from an unsigned script is unreliable/silently dropped on recent macOS without a properly signed helper (e.g. `terminal-notifier`, not installed on this machine, and not something to require of every user of an OSS local-first tool just for this). Decision: **don't chase this further** — reverted the osascript path entirely.

## Final design (v3)

VS Code-family fallback is toast-only: `ringBellIfUnfocused` (`use-chat.ts`) gates on `isTerminalFocused()` for both branches — native BEL for real terminals, `notifyVsCode(...)` → `vscode.window.showInformationMessage(...)` for `TERM_PROGRAM === "vscode"`. No `state.focused` branching, no `osascript`, no debug logging — all removed. `EXTENSION_VERSION` ended at `0.6.0` after the version churn from iterating live (`0.2.0` add fallback → `0.3.0` add osascript+state.focused → `0.4.0`/`0.5.0` debug logging → `0.6.0` final cleanup).

**Known accepted limitation**, worth being upfront about: inside a VS Code-family editor, the toast only helps if the user looks back at the editor window at some point — it cannot reach them while they're in a genuinely different application, the same way a real terminal's BEL-triggered dock bounce can. Revisit only if `terminal-notifier` (or an equivalent signed-helper approach) becomes an acceptable dependency.

## Follow-up: fixed the vscode-extension build no-op

Separately fixed the `packages/vscode-extension` `build` script gap flagged during v1 (`tsc -p tsconfig.json` was a silent no-op, `noEmit: true` never overridden). Root cause went deeper than that one flag: `@koincode/shared`'s `package.json` exports raw `.ts` source with no compiled output, resolvable only under Bun's own resolver — never under the plain Node.js the extension host runs on, so `extension.ts` importing from it could never produce genuinely working emitted output no matter the tsconfig settings (confirmed by trying `bun build` as a bundler alternative, which "worked" but pulled in 162 modules / 0.7MB to inline three path constants — rejected as bloat). Fix: removed the `@koincode/shared` import from `extension.ts` and inlined `GLOBAL_CONFIG_DIR`/`IDE_CONTEXT_FILE`/`NOTIFY_REQUEST_FILE` by hand, matching what the embedded `ide-extension-assets.ts` copy already had to do for the same reason. With that dependency gone, `tsconfig.json` safely got `module: CommonJS`, `moduleResolution: node`, `esModuleInterop: true`, `noEmit: false`, `outDir: out`, `rootDir: src` (`allowImportingTsExtensions: false` too, since that flag requires `noEmit`), and `bun run --cwd packages/vscode-extension build` now emits a real, dependency-free, working `out/extension.js`. Removed the now-unused `@koincode/shared` workspace devDependency.

## Status

Implemented and settled after live testing in Antigravity.

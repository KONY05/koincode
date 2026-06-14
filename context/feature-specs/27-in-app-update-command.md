# Feature Spec 27 — In-App Update Command (`/update`)

## Problem

koincode is distributed via npm global install, which typically requires `sudo` on systems where the npm prefix is owned by root. This means the background auto-update approach (spawning `npm install -g koincode` silently) fails with a permission error. Users have no in-app way to update.

## Goal

Add a `/update` slash command that:
1. Checks if a newer version is available
2. Gracefully tears down the TUI
3. Runs `npm install -g koincode` (or with sudo if needed) in the restored terminal so the user can see the output and provide their password if prompted
4. Prints a completion message and exits — the shell prompt appears naturally

## User Flow

```
[user is in any session, sees "new version available" badge in footer]

user types: /update

koincode: Checking for updates...
koincode: New version v1.2.0 found. Installing...

[TUI tears down — terminal returns to normal mode]

npm warn ...
added 3 packages in 4s

koincode updated to v1.2.0 — run koincode to start the new version.

mac@kony ~/dir %
```

If no update is available:
```
koincode: Already on the latest version (v1.1.6).
```

If permission denied (needs sudo):
```
koincode: Permission denied. Run: sudo npm install -g koincode
```

## Implementation Plan

### 1. Version check utility (`packages/cli/src/lib/update.ts`)
- `checkForUpdate(): Promise<string | null>` — fetches `https://registry.npmjs.org/koincode/latest`, returns new version string or null if already latest
- `runUpdate(): Promise<void>` — tears down the renderer, spawns `npm install -g koincode` with `stdio: "inherit"`, handles EACCES by printing the sudo fallback message, then calls `process.exit(0)`

### 2. Renderer access
- OpenTUI's renderer instance is created in `index.tsx`. Export it or expose a `destroyRenderer()` function so `runUpdate()` can call `renderer.destroy()` before spawning npm.

### 3. Slash command registration
- Register `/update` in the existing slash command system (same place as `/clear`, `/compact`, etc.)
- Handler: call `checkForUpdate()`, show appropriate message in chat, then call `runUpdate()` if a new version exists

### 4. `useAutoUpdate` hook (already exists)
- Already detects new versions and shows "new version available" badge
- No changes needed — the badge is the discovery mechanism, `/update` is the action

## Edge Cases

- **No update available** — show message, do nothing
- **Permission denied (EACCES)** — print `sudo npm install -g koincode` and exit
- **Offline / registry unreachable** — show "could not check for updates"
- **Mid-stream response** — if AI is currently streaming, either block the command or cancel the stream first before tearing down

## Server Shutdown During Update

The server process is spawned detached and stays alive after the TUI exits. If the update replaces files on disk while the old server is still running, the next `koincode` launch will find the old server healthy and reconnect to it — causing a version mismatch if any API contracts changed.

`runUpdate()` must kill the server before calling `process.exit(0)`:

1. Read the PID from `PID_FILE`
2. Send `SIGTERM` to that PID (ignore errors — process may already be dead)
3. Delete `PID_FILE`
4. Then `process.exit(0)`

This ensures the next launch always spawns the freshly installed server binary. No need to wait for the process to fully exit — the next CLI invocation's `ensureServerRunning()` already handles that via its health-check + spawn loop.

## Out of Scope

- Auto-installing without user intent (permission issues make this unreliable)
- Platform-specific update mechanisms (Homebrew, apt, etc.)

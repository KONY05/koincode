# Feature 46: MCP Status Command

## Origin

i was thinking if we should add a mcp command that shows the enabled and connected mcp servers with their status, not sure if to only show per project mcp or global in the command

## Current state (already built, Feature 23)

MCP support already exists end to end — this feature is not "add MCP," it's "add a dedicated status view on top of what's already tracked."

| Piece | Location |
|---|---|
| Server connects to configured servers at startup (stdio/SSE/streamable HTTP) | `packages/server/src/lib/mcp-manager.ts` |
| Config read + merge (global `~/.koincode/config.json` + project `.koincode/config.json`, project wins on name collision) | `mcp-manager.ts`'s `readMcpConfigs()` |
| `GET /mcp/servers` → `{name, status, toolCount, error?}[]` | `packages/server/src/routes/mcp.ts`, `getMcpServerStatus()` |
| CLI hook fetching that list | `packages/cli/src/hooks/use-mcp-servers.ts` |
| Compact display: connected-count label | `packages/cli/src/components/status-bar.tsx` |
| Compact display: per-server name + connected/error dot | `packages/cli/src/components/info-sidebar.tsx` (opt-in, `/info`) |
| LLM-facing read tool (list servers/status/tool count) | `manageMcp` in `packages/shared/src/schemas.ts:386` |
| Restarts KOINCODE's whole local server process (used by `/setup` after an API-key change, since keys are only read via env vars at spawn time) | `restartServer()` in `packages/cli/src/lib/server-manager.ts` |

## Gaps the existing displays don't cover

1. **Config source is discarded.** `readMcpConfigs()` merges global + project into one flat object — nothing downstream knows whether a given server came from the global config or the project config, or that a project entry silently overrode a global one of the same name.
2. **Disabled servers are invisible everywhere, with no way to opt in per-caller.** `initializeMcp()` filters out `enabled: false` entries *before* populating the `servers` map, so `getMcpServerStatus()` never returns them at all, to any caller.
3. **No dedicated detail view.** The sidebar is opt-in, always-compact (name + one-word status), and easy to miss. There's no on-demand command that shows the full picture (source, disabled state, per-server error text) in one place.
4. **No way to flip a server on/off short of hand-editing a config file** and restarting KOINCODE.

## Goal

A `/mcp` command that opens a status dialog (same base interaction pattern as `/review-status`, plus row selection like `/setup`) listing every configured MCP server — connected, error, **and disabled** — each tagged with its config source (global vs. project), with tool count and error detail per server, and an action to toggle a server's enabled state without restarting anything.

## Scope decision: global vs. project

Show both together in one merged list, each row labeled `[global]` or `[project]` — not a scope toggle and not two separate views. Rationale: the whole point of a status command is "what's actually active right now," and project-overriding-global is exactly the kind of thing worth surfacing when it happens, not hiding behind a toggle the user has to think to flip. If a project server overrides a global one of the same name, show the project row as active and note the shadowed global entry rather than dropping it silently.

## Scope decision: disabled-server visibility

Keep the current behavior everywhere it's already relied on (sidebar, status bar, `manageMcp` LLM tool) — disabled servers stay invisible there by default. Add an `includeDisabled` param to `getMcpServerStatus()` (default `false`), threaded through `GET /mcp/servers?includeDisabled=true` and an optional param on `useMcpServers()`. Only the new `/mcp` dialog passes `includeDisabled: true`. No existing call site changes behavior.

## Scope decision: status values

No new `"disabled"` status. `McpServerEntry["status"]`'s existing `"disconnected"` value is declared and documented ("was connected, then closed") but never actually produced by the code today — `shutdownMcp()` clears the whole `servers` map on exit rather than leaving entries behind marked disconnected, so in practice no caller has ever seen this value. Repurpose it: `"disconnected"` now means "configured, not currently connected" — covers both a disabled server (never attempted) and any future genuine disconnect, with zero new enum values. Update the JSDoc on `getMcpServerStatus()` accordingly.

## Scope decision: enable/disable toggle

In scope, implemented as an in-process reconnect/disconnect — **not** a reuse of `restartServer()`. That function restarts KOINCODE's entire local server process, which exists only because provider API keys are read from env vars once at process spawn (no other way to pick up a changed key). MCP servers have no such constraint: `mcp-manager.ts`'s `servers` map and the `/mcp` routes run in the same process, so a single server can be connected or disconnected directly, in place, with zero effect on the live AI stream or any other MCP server. Restarting the whole server to flip one toggle would be strictly worse (drops everything) for no benefit.

## Net-new work required

1. **`readMcpConfigs()` → tag source.** Return `Record<string, McpServerConfig & { source: "global" | "project" }>` (or a parallel lookup) so project-vs-global survives the merge. Project entries still win on name collision; retain the shadowed global entry somewhere for the "overridden" note.
2. **`McpServerEntry` gains a `source` field**, set at every point an entry is created (`connectServer`'s success path, its catch-block error path, and the new disabled-registration path below).
3. **Track disabled servers instead of dropping them.** `initializeMcp()`: for entries with `enabled === false`, `servers.set(name, { client: null!, tools: {}, status: "disconnected", source })` directly — no connection attempt — instead of filtering them out of the startup loop entirely.
4. **`getMcpServerStatus(includeDisabled = false)`** filters out `status === "disconnected"` entries unless `includeDisabled` is true. Default behavior is unchanged for every existing caller.
5. **`GET /mcp/servers?includeDisabled=true`** — optional query param on the route, passed through to `getMcpServerStatus()`.
6. **`useMcpServers(options?: { includeDisabled?: boolean })`** — passes the param through to `apiClient.mcp.servers.$get`. Existing call sites (sidebar, status bar) pass nothing, unaffected.
7. **`setServerEnabled(name: string, enabled: boolean)`** (new, `mcp-manager.ts`): resolves which config file actually declares `name` (project first, then global — same precedence as the merge), rewrites that file's `mcpServers[name].enabled`, then either calls the existing `connectServer(name, config)` (enabling) or closes the client and marks the entry `{ status: "disconnected" }` (disabling) — in-process, no restart. Direct `fs` read/write here matches the pre-existing pattern in this file (and `server/src/lib/models.ts`/`ollama.ts`) rather than introducing a new config-write abstraction.
8. **New route**, e.g. `POST /mcp/servers/:name/enabled` with `{ enabled: boolean }` body, returns the updated single-server status entry (or the full refreshed list — CLI's choice).
9. **New dialog component** `packages/cli/src/components/dialogs/mcp-status-dialog.tsx` (`McpStatusDialogContent`): calls `useMcpServers({ includeDisabled: true })`, renders rows grouped/labeled by source with a status dot (connected/error/disconnected colors), tool count, and error text. Row selection (↑↓) plus an action key to flip enabled state, modeled on `/setup`'s row-based edit pattern (`setup-dialog.tsx`) rather than `/review-status`'s pure-display one.
10. **New command entry** in `packages/cli/src/components/command-menu/commands.tsx`, following the `review-status` entry: `{ name: "mcp", description: "Show configured MCP servers and toggle them on/off", value: "/mcp", action: (ctx) => ctx.dialog.open({ title: "MCP Servers", children: <McpStatusDialogContent /> }) }`.

## Explicitly out of scope for v1

- **No per-server tool name listing**, just the existing `toolCount`. Full tool lists (could be dozens per server) don't fit a compact terminal dialog well; count + error text is enough to answer "is this working."
- **No adding/removing/editing a server's config** (command, args, env, url) from the dialog — only the `enabled` flag. Full CRUD on server definitions is a separate, larger feature if wanted later.

## Package boundaries

Touches server (`mcp-manager.ts`, `routes/mcp.ts`) and CLI (`use-mcp-servers.ts`, new dialog component, `commands.tsx` entry). No `@koincode/shared` schema changes needed — `McpServerConfig` itself is unchanged, only server-side status aggregation and a new write path are added.

## Open questions

None outstanding — resolved above: merged global/project view with source tags; disabled visibility gated behind an opt-in param so existing displays are unaffected; no new status enum value (`disconnected` repurposed); enable/disable toggle in scope via in-process reconnect, not a full server restart.

## Status

Implemented. See `progress-tracker.md`'s "MCP status command" entry for the concrete file-level breakdown.

**One deliberate simplification vs. the plan above**: when a project server shadows a global one of the same name, the shadowed global entry is not separately retained anywhere — `readMcpConfigs()` just overwrites it during the merge, same as it always has. The dialog shows the effective (project) entry with its source tag; it doesn't call out "there's also a hidden global one by this name." Keeping that would have meant threading a second, mostly-unused data shape through the manager, the route, and the dialog for an edge case (two configs defining the same server name) that's rare for a single-user local tool — not worth it for v1.

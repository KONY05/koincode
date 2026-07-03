# Feature 35: Info Sidebar Display

## Origin

Reference: OpenCode's right-hand info panel (screenshot supplied by user) — shows session title, context usage, MCP status, LSP status, and a list of modified files with per-file diff stat.

## Goal

An optional right-hand sidebar in the Session screen showing at-a-glance session info. Off by default — opt-in only, via:

- `--info` CLI flag (sidebar starts open for the session)
- `/info` slash command (toggles sidebar visibility at any point in a session)

## Layout

- Sidebar renders alongside the existing chat view as a right-hand column (not a replacement for the current bottom `StatusBar` — that stays as-is for the default, non-info view).
- Chat scrollbox and input bar shrink to make room; sidebar is fixed-width.
- No sidebar in PLAN/BUILD toggle or other modal state — it's a passive display panel, not interactive (matches the reference image: no focus ring, no keyboard nav into it).

## Fields (v1 scope)

| Field | Source | Status |
|---|---|---|
| Session title | Session record | Exists, not yet rendered in-session |
| Context usage (tokens, %, cost) | `use-chat.ts` `ContextUsage` | Tokens/% exist; **cost is net-new** |
| Connected MCP servers | `apiClient.mcp.servers.$get()` | Exists (count only) — sidebar shows full per-server list + status, not just a count |
| Modified files | Git working tree | **Net-new** — derive from `git status`/`git diff`, show path + added/removed line counts |

**LSP status is out of scope** — KOINCODE has no language-server integration, unlike OpenCode. Not included in v1.

## Net-new work required

1. **Cost tracking** — sum per-message cost using each model's pricing (`@koincode/shared/models.ts` already has pricing per model) against `inputTokens`/`outputTokens` from message usage metadata. Needs a `sessionCost` aggregator, likely alongside the existing `contextUsage` memo in `use-chat.ts`.
2. **Modified files list** — shell out to git (same `execSync` pattern as `getGitBranch()` in `utils/helper.ts`): `git status --porcelain` for the file list + status, `git diff --numstat` for added/removed counts on tracked files. Untracked files (new files `writeFile` created) don't appear in `diff --numstat` — read their line count directly and show as all-additions. Reflects the repo's full current dirty state (not scoped to files touched this session) — simpler, no session-tracking state needed, and arguably more useful since it also surfaces pre-existing uncommitted changes. Not a git repo → hide the section (no error state needed).
3. **Toggle plumbing** — `--info` flag parsed in `index.tsx` (same manual argv pattern as `--anthropic-key` etc.) sets initial state; `/info` command entry in `commands.tsx` flips it at runtime. State most likely lives in a small new context or as local state in `session.tsx`, passed down to a new `InfoSidebar` component alongside `SessionShell`.
4. **Per-server MCP list** — `apiClient.mcp.servers.$get()` already returns per-server status; sidebar just needs to render the full array instead of the count-only reduction `StatusBar` does today.

## Package boundaries

CLI-only feature. No server route changes, no schema changes — everything needed (pricing table, MCP server list, message/tool-call history) is already available to the CLI client. Satisfies the "don't combine changes across unrelated packages" rule as a single-package unit.

## Open questions (resolved)

- ~~Sidebar vs. replacing status bar?~~ → Alongside, as an optional panel.
- ~~Build cost tracking now or defer?~~ → Include in v1.

## Status

Implemented. See `progress-tracker.md` "Info sidebar display" entry for the concrete file-level breakdown.

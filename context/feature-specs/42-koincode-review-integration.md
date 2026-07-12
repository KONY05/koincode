## Decision

Phase 1 scope: browser-based device-auth login plus repo connect/disconnect/status/open, driven from a new `/review` command family. Pushing the CLI's active provider key + model into Review's account settings is deferred to a follow-up phase — it needs its own design pass around how it reconciles with Review's existing multi-key table, and shouldn't block shipping the pairing flow.

This is a two-repo feature. The new API surface it depends on (device auth, `cli_tokens` table, repo connect/disconnect-by-name routes) is specified separately in `KOINCODE-Review/context/feature-spec/14-cli-integration-auth.md` — this doc covers the CLI-side half only.

## Design

### Auth: `/review login`

1. CLI calls `POST {reviewApiUrl}/api/cli/device` → `{ deviceCode, verificationUrl, expiresIn, interval }`.
2. CLI opens the system browser to `{verificationUrl}?device_code={deviceCode}` (reuse whatever `shell`'s `open`/platform-detection already does elsewhere, or `open`-style spawn if nothing exists yet).
3. CLI polls `POST {reviewApiUrl}/api/cli/device/token` with `{ deviceCode }` at the returned `interval`, showing a spinner ("Waiting for approval in browser…") until it gets back a token, `expired`, or `denied`.
4. On success, store `{ token, userId }` in a new `~/.koincode/review-auth.json` — deliberately **not** folded into `~/.koincode/config.json`, since that file holds provider API keys read through the existing config module (`code-standards.md`: "all key and preference reads go through the config module") and this is a different kind of credential (a bearer token for an external service, not a model provider key). New `packages/cli/src/lib/review-auth.ts` owns reading/writing this file, mirroring the existing config module's shape (typed read/write, no direct `fs` calls from callers). `reviewApiUrl` is not part of this file — see below.
5. **`reviewApiUrl` resolution — settled, no override mechanism needed.** Follows the same `process.env.NODE_ENV` gate already used in `lib/sentry.ts` and `lib/analytics.ts` (`"production"` check), not a new pattern: `lib/review-api.ts` picks between two hardcoded constants, `REVIEW_API_URL_PROD` and `REVIEW_API_URL_DEV` (`http://localhost:3000`, Next's default `next dev` port — confirmed via `KOINCODE-Review/package.json`'s `dev` script, no custom port configured). `NODE_ENV` is already `"development"` for `bun run dev:cli` and `"production"` for built/compiled binaries (same mechanism `server-manager.ts` already sets when spawning the local server). No env var, no config field, no CLI flag — one less thing to document or get out of sync.

### Repo identification

All three repo commands resolve the current repo the same way: `git remote get-url origin` (already how `lib/git-status.ts` shells out for `getModifiedFiles`/`getGitBranch` — follow that pattern, don't add a second git-shelling convention), parsed into `{ owner, repo }`. Non-GitHub remotes (GitLab, Bitbucket, no remote at all) produce a clear inline error — Review is GitHub-only today (`KOINCODE-Review/context/project-overview.md`'s Out of Scope), so there's nothing to connect.

### Commands — flat, hyphenated, added to the existing `COMMANDS` array in `commands.tsx`

**Naming correction from the initial draft:** this codebase's command menu has no subcommand parsing — every entry in `packages/cli/src/components/command-menu/commands.tsx`'s `COMMANDS` array is one self-contained, hyphenated string (`/enable-browser-tools`, `/browser-headless`, `/restart-server`), each independently fuzzy-searchable and matched to exactly one `action`. `/review connect`-style space-separated subcommands don't fit that model. Renamed to `/review-login`, `/review-connect`, `/review-disconnect`, `/review-status`, `/review-open`.

Also correcting the file layout from the initial draft: there's no one-file-per-command convention either — every existing command is a plain object literal inline in `COMMANDS`, with any real logic imported from `lib/*.ts` (see `/update`'s use of `lib/update-cli.ts`, `/usage`'s use of `lib/usage.ts`). The five new entries follow that same shape: added directly to `COMMANDS` in `commands.tsx`, delegating to `lib/review-auth.ts` and `lib/review-api.ts` for actual work.

- **`/review-login`** — runs the device-auth flow above. No-ops with a toast if already logged in (`review-auth.json` exists); a forced re-login isn't needed for phase 1.
- **`/review-connect`** — requires login (toast pointing at `/review-login` if not); resolves the current repo; calls `POST /api/cli/repos/connect` with the Bearer token. Success/error surfaced as a toast, same as other CLI actions.
- **`/review-disconnect`** — same shape against `/api/cli/repos/disconnect`.
- **`/review-status`** — `GET /api/cli/repos/status`, then opens a dialog (not a toast — this is a data view, not a fire-and-forget action) via `ctx.dialog.open({ title: "Review Status", children: <ReviewStatusDialogContent .../> })`, matching `/context`'s pattern exactly (`ContextDialogContent` in `context-dialog.tsx`: a plain `<box flexDirection="column">` with theme-colored `<text>` rows, no interactivity). New `ReviewStatusDialogContent` in `components/dialogs/review-status-dialog.tsx`, exported from `dialogs/index.tsx` alongside the others. Shows connected/not, and last-review summary (status, timestamp) when connected.
- **`/review-open`** — opens the Review dashboard in the browser via the existing `openUrl()` helper (`lib/usage.ts` — `execSync`-based `open`/`start`/`xdg-open` per platform; already exactly what this needs, no new browser-opening code and no reason to reach for the unused `open` npm devDependency sitting in `package.json`). **Target resolved:** KOINCODE-Review has no dedicated per-repo page yet (checked `app/(dashboard)/repos/page.tsx` — one list page, `/repos`, with a client-side "All"/"Connected" tab toggle that isn't URL-addressable). Phase 1 sends the user to `/repos` unconditionally — closer to "your repo" than the generic `/dashboard` stats page, and it's where a just-connected repo will actually show up. A per-repo deep link (`/repos/[id]` or similar) is a natural follow-up once that page exists on the Review side, not blocking here. Works without being logged in too (opens the landing page, which is itself the login entry point) — this command has no failure mode, unlike the other four.

All four non-open, non-status-view commands share a small `lib/review-api.ts` client (base URL + bearer token + typed request/response, one function per route). **No axios or other HTTP client library** — this codebase has none today; `api-client.ts` (the local-server client) wraps native `fetch` directly via Hono's `hc()`, and `lib/review-api.ts` follows the same convention: plain `fetch`, typed request/response shapes, one function per route (`loginDevice`, `pollDeviceToken`, `connectRepo`, `disconnectRepo`, `getRepoStatus`). Unlike `api-client.ts`, no `fetchWithRestart`-style retry wrapper is needed — that exists specifically because the *local* server can go idle and needs restarting; the Review API is an always-on external service, so a plain failed fetch is just a plain failed fetch (surfaced as a toast, per Error handling below).

### Error handling

- No `review-auth.json` → any command other than `login`/`open` tells the user to run `/review login` first, does not silently trigger login itself (explicit is better here — logging in opens a browser, which shouldn't happen as a surprising side effect of `/review connect`).
- Expired/revoked token (401 from any Bearer-authed route) → same "run `/review login`" message, and the stale `review-auth.json` is deleted so the next attempt doesn't loop on a dead token.
- Network failure reaching `reviewApiUrl` → toast with the raw error; no retry loop (matches how other CLI network calls fail today).

## Package boundaries

This spans two separate repositories, not two packages in one monorepo — `ai-workflow-rules.md`'s package-boundary guidance is written for `@koincode/*` workspaces and doesn't anticipate this. Within this repo, the change is CLI-only:

- New files live entirely under `packages/cli/src/` (`lib/review-auth.ts`, `lib/review-api.ts`, `components/dialogs/review-status-dialog.tsx`), plus five new entries appended to the existing `COMMANDS` array in `components/command-menu/commands.tsx`.
- No `@koincode/shared` changes needed — this doesn't touch the tool-contract/model-registry surface shared with the server, and the local Hono server has no involvement (this is the CLI talking directly to an external HTTPS API, same category as the existing `update.ts`'s npm-registry fetch, not a `chat.ts`-style AI orchestration path).
- No `@koincode/server` or `@koincode/database` changes.

## Suggested implementation order

1. `lib/review-auth.ts` (read/write `review-auth.json`) + `lib/review-api.ts` (`fetch`-based typed client, `reviewApiUrl` resolved via `NODE_ENV`, no routes wired yet). Verifiable alone: unit-shape only, nothing to run end to end yet.
2. `/review-login` against the Review-side device-auth routes (needs `14-cli-integration-auth.md` implemented first, or at least stubbed). Verifiable alone: run `/review-login`, approve in browser, confirm `review-auth.json` is written with a valid token.
3. `/review-status` and `/review-open` — read-only, lowest risk, good smoke test for the Bearer-auth plumbing before adding mutations. `/review-status` also needs `ReviewStatusDialogContent` wired into `dialogs/index.tsx`.
4. `/review-connect` / `/review-disconnect`. Verifiable alone: connect a real test repo from the CLI, confirm it shows as connected in the Review dashboard's `/repos` page and a webhook was installed; disconnect and confirm the reverse.
5. Error-path pass: expired token, no git remote, non-GitHub remote, repo the user doesn't have access to.

## Open questions / deferred

- **Key/model sync** (pushing the CLI's active provider key + model into Review's `api_keys` table) — explicitly deferred out of phase 1, see Decision above.
- **Multiple Review accounts / logout** — `/review-login` phase 1 assumes one account per machine, no `/review-logout` command yet. Low cost to add later (delete `review-auth.json`), not needed for the initial flow.
- **Dedicated per-repo page on the Review dashboard** — `/review-open` targets the plain `/repos` list for phase 1 since no such page exists yet (see Design above). Worth revisiting once/if the Review app grows one.

All previously-open questions about command naming, the `/review-status` dialog vs. toast, the `/review-open` target, HTTP client choice, and `reviewApiUrl` resolution are now settled — see Design above.

# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase
- Phase 2: Local-First Pivot — planning

## Current Goal
- Phase 2 Feature 01: Strip auth & billing, switch to SQLite, add OpenRouter + direct provider key support

## Completed

### Phase 1 — Original Tutorial Build (nightcode → koincode)

- Feature 01: Project setup and component architecture — Bun monorepo scaffolded with four workspaces (`@koincode/cli`, `@koincode/server`, `@koincode/database`, `@koincode/shared`). Root `package.json` with `dev:cli`, `dev:server`, `build:cli`, `link:cli` scripts. `tsconfig.base.json` with strict mode. CLI entry point `packages/cli/src/index.tsx` bootstrapping OpenTUI renderer.
- Feature 02: UI infrastructure — OpenTUI and React 19 wired up. Terminal layout primitives (Box, Text) confirmed working. Theme and provider scaffolding in place.
- Feature 03: Routing and screen layout — React Router 7 installed. Three screens added: `Home` (session list), `NewSession`, `Session` (active chat). Screen shell layouts and navigation flow confirmed working in terminal.
- Feature 04: Server, shared, and database packages — Hono server at `packages/server/src/index.ts` on port 3000. Route groups `/auth`, `/billing`, `/sessions`, `/chat` scaffolded. Prisma schema with `Session` model (id, userId, title, messages JSON, timestamps). `@koincode/shared` with model registry (`models.ts`) and Zod tool schemas (`schemas.ts`). Prisma client generated via `@prisma/adapter-pg`.
- Feature 05: AI chat streaming — `POST /chat/submit` wired to AI SDK (`ai` + `@ai-sdk/anthropic`). Server streams text generation back to CLI. `hooks/use-chat.ts` in CLI consumes the stream via `@ai-sdk/react`. Streaming responses render in real time in the Session screen.
- Feature 06: Session management and config — Session CRUD endpoints (`GET /sessions`, `POST /sessions`, `GET /sessions/:id`, `PATCH /sessions/:id`). Session list on Home screen. Session title auto-generated from first message. Full message history persisted as JSON blob on the `Session` model. Model selection config wired.
- Feature 07: Tool calling — AI SDK tool calling enabled on server. PLAN mode tool set (readFile, listDirectory, glob, grep) and BUILD mode tool set (+ writeFile, editFile, bash) defined in `@koincode/shared/schemas.ts`. Tool calls streamed from server to CLI for local execution. Tool results sent back to server for next model turn.
- Feature 08: User experience — Terminal UI polish: command menu, keyboard shortcuts, toast notifications, dialog provider, prompt config provider. Mode indicator (PLAN/BUILD) visible in the session screen. Smooth streaming display and input bar improvements.
- Feature 09: Billing — Polar SDK integration. `credits.ts` middleware checks Polar credit balance before each chat request. Post-response credit ingestion from token usage. `/billing/checkout` route opens Polar checkout flow.
- Feature 10: Client-side tool execution — Tool calls fully executed on the CLI side (not server-side). Server streams tool call definitions; CLI runs them locally against the user's filesystem. Tool results returned to server to continue the AI turn. Filesystem isolation confirmed — server never touches user files.
- Feature 11: Final polish — End-to-end flow verified. Readme expanded with setup guide and branch-based tutorial structure. CodeRabbit badge added.
- Rebrand: nightcode → koincode — Package names, imports, CLI binary, and all references updated from `@nightcode/*` to `@koincode/*`. Branch: `refactor/rebrand-to-koincode`.

## In Progress

- None.

## Next Up

### Phase 2 — Local-First Pivot

- **P2-F01:** ✅ Done. Removed Clerk auth middleware, all auth routes, Polar billing middleware and billing routes. Removed `@clerk/backend` and `@polar-sh/sdk` dependencies. Removed all `userId` references from routes, schema, and generated Prisma client. Server is now unauthenticated — all endpoints accessible from localhost only. Removed `/login`, `/logout`, `/upgrade`, `/usage` CLI commands.
- **P2-F02:** ✅ Done. Swapped `@prisma/adapter-pg` → `@prisma/adapter-better-sqlite3`. Schema changed to `provider = "sqlite"`. DB path: `~/.config/koincode/data.db`. Initial migration generated at `packages/database/prisma/migrations/`. `prisma.config.ts` now computes the path dynamically (no `.env` required for DB). Server runs `prisma migrate deploy` on startup. CLI spawns the server on first run via `server-manager.ts` — health-check at `/health`, polls until ready, restarts on `ECONNREFUSED`. Server auto-shuts after 30 min of idle, CLI restarts it transparently. Port updated from 3000 → 37420 everywhere.
- **P2-F03 + P2-F04:** ✅ Done. OpenRouter integration and multi-provider key support implemented together. Keys stored in `~/.koincode/config.json` (`KoincodeConfig` type in `@koincode/shared`). CLI reads config and passes keys as env vars when spawning the server. Server model resolver checks for a direct provider key first (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and falls back to OpenRouter (`OPENROUTER_API_KEY`) for any model whose native key is absent. `/setup` command opens a dialog with rows for OpenRouter, Anthropic, OpenAI, and Gemini keys — navigate with ↑↓, Enter to edit, Esc to cancel/close. Keys can also be saved non-interactively: `koincode --openrouter-key sk-xxx`, `--anthropic-key`, `--openai-key`, `--gemini-key`.
- **P2-F05:** Update server port from 3000 → 37420 across server config, `API_URL` default, and CLAUDE.md.

## Deferred (Future Implementation)

These were scoped out during system prompt improvements and should be revisited:

- **User memory in system prompt** — Add a `Memory` table to the Prisma schema (content: string, createdAt). Fetch all rows on each chat request, concatenate, and pass to `buildSystemPrompt` as `userMemory`. The `buildSystemPrompt` function already has a stubbed `userMemory?: string` param and commented-out section ready to activate.
- **Compression prompt** — Implement context window compression. When conversation length approaches the model's limit, summarize completed work into a structured continuation prompt (original goal, completed actions, current state, remaining tasks, next step, key context) and replace the history. Prevents context overflow mid-task.

## Open Questions

- None.

## Architecture Decisions

- Bun workspaces monorepo — four packages: cli, server, database, shared.
- OpenTUI + React 19 for terminal rendering (not Ink).
- Tool calls executed client-side in the CLI; server only orchestrates the AI turn.
- Provider resolution is model-driven: the model the user selects determines which key is used. Direct provider keys (Anthropic, OpenAI, Gemini) take priority when the model maps to that provider; OpenRouter is the fallback for any model without a matching direct key.
- Config stored globally at `~/.koincode/config.json` — holds provider keys and user preferences, shared across all projects.
- Message history stored as a JSON blob on the Session row rather than normalized message rows.
- PLAN mode and BUILD mode share the same session; mode is selected at session creation and controls which tools are exposed to the model.

## Session Notes

- Bun as package manager and runtime throughout (no Node/npm).
- React 19.2.4, React Router 7, Zod 4, Hono 4, AI SDK 6.
- Default model: `claude-opus-4-6` (will become an OpenRouter model in Phase 2).
- Production DB was Neon PostgreSQL — being replaced with local SQLite in Phase 2.
- Port changing from 3000 → 37420 in Phase 2 to avoid common port conflicts.

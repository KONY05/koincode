# Code Standards

## General

- Keep modules small and single-purpose.
- Fix root causes — do not layer workarounds.
- Do not mix unrelated concerns in one component or route.
- Every package has a clear boundary: `cli` owns UI and local tool execution, `server` owns AI orchestration, `database` owns the schema, `shared` owns contracts used by both.

## TypeScript

- Strict mode is required throughout the project (`tsconfig.base.json`).
- Avoid `any`; use explicit interfaces or narrowly scoped types.
- Validate unknown external input at system boundaries (user input, config file reads, AI SDK responses) before trusting it.
- Use `type` throughout — for object shapes, unions, and aliases alike. Avoid `interface`.

## Terminal UI (CLI)

- Components use OpenTUI primitives — do not reach for DOM or browser APIs.
- Keep screen components (`screens/`) as thin shells; push logic into hooks or `lib/`.
- Providers in `providers/` manage global state (dialog, keyboard, theme, toast) — consume them via their exported hooks, do not prop-drill.
- `hooks/use-chat.ts` is the single source of truth for AI streaming state — do not duplicate stream handling in components.

## Hono Server

- Keep route handlers thin — validate input, call a lib function, return the result.
- Middleware runs before every protected route; do not re-implement auth or credit checks inside route handlers.
- Long-running or multi-turn AI work belongs in `routes/chat.ts` with the AI SDK; do not inline model calls elsewhere.
- Return consistent JSON response shapes from all endpoints.

## Tool Contracts

- Tool definitions live in `@koincode/shared/schemas.ts` — never hardcode tool schemas in the CLI or server.
- PLAN mode exposes only read-only tools; BUILD mode adds write and bash tools. This distinction must be preserved when adding new tools.
- Tool execution always happens client-side in the CLI — the server must never execute tools or touch the user's filesystem.

## Provider & Config

- Provider resolution is model-driven: the selected model determines which API key is used. Direct provider keys take priority; OpenRouter is the fallback.
- All key and preference reads go through the config module — do not read `~/.koincode/config.json` directly from route handlers or components.
- Never log or expose API keys in responses, errors, or terminal output.

## Data

- All persistent state lives in the local SQLite database via Prisma.
- Session message history is stored as a JSON blob on the `Session` row — do not normalize messages into separate rows.
- Run `bun run db:generate` in `packages/database/` after any schema change.

## File Organization

- `packages/cli/src/lib/` — shared CLI infrastructure: API client, auth state, config, local tools.
- `packages/cli/src/hooks/` — stateful logic consumed by screens and components.
- `packages/cli/src/providers/` — global state managers; one provider per concern.
- `packages/cli/src/screens/` — top-level routed screens; composition only, no business logic.
- `packages/server/src/lib/` — server infrastructure: model lookup, provider resolution, credits, utilities.
- `packages/server/src/routes/` — one file per route group; thin handlers only.
- `packages/shared/src/` — contracts shared between CLI and server; no runtime dependencies on either.
- Name files after the responsibility they contain, not the technology.

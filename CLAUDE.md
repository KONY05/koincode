# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Building Context

Read the following files in order before implementing or making any architectural decision:

1. `context/project-overview.md` — product definition, goals, features, and scope
2. `context/code-standards.md` — implementation rules and conventions
3. `context/ai-workflow-rules.md` — development workflow, scoping rules, and delivery approach
4. `context/progress-tracker.md` — current phase, completed work, open questions, and next steps

Update `context/progress-tracker.md` after each meaningful implementation change.

If implementation changes the architecture, scope, or standards documented in the context files, update the relevant file before continuing.

## What This Is

KOINCODE is a terminal-based AI coding agent — a CLI tool that lets users chat with AI models in the terminal, with PLAN mode (read-only analysis) and BUILD mode (full file editing and bash execution). It uses streaming responses, persistent sessions, OAuth via Clerk, and credit-based billing via Polar.

## Monorepo Structure

Bun workspaces under `packages/`:

| Package | Purpose |
|---|---|
| `@koincode/cli` | Terminal UI client (React 19 + OpenTUI) |
| `@koincode/server` | Hono API server (port 3000) |
| `@koincode/database` | Prisma schema + generated client |
| `@koincode/shared` | Shared Zod schemas, model registry, tool contracts |

## Commands

```bash
# Development
bun run dev:cli       # Watch mode for CLI (packages/cli/src/index.tsx)
bun run dev:server    # Hot-reload server (packages/server/src/index.ts)

# Build & Link CLI globally
bun run build:cli
bun run link:cli      # builds then runs `bun link` in packages/cli

# Database
cd packages/database && bun run db:generate   # Regenerate Prisma client after schema changes
```

No test framework is configured. TypeScript strict mode (`tsconfig.base.json`) is the primary correctness check.

## Environment Setup

Copy `.env.example` to `.env` at the repo root. Required variables:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/koincode
API_URL=http://localhost:3000
JWT_SECRET=<any string>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
CLERK_FRONTEND_API=        # From Clerk dashboard
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_OAUTH_CLIENT_ID=     # Clerk OAuth app credentials
CLERK_OAUTH_CLIENT_SECRET=
POLAR_ACCESS_TOKEN=
POLAR_PRODUCT_ID=
POLAR_CREDITS_METER_ID=
POLAR_SERVER=sandbox       # or "production"
```

## Architecture

### Request Flow

1. **Auth:** CLI opens Clerk OAuth in browser → server handles callback at `POST /auth/callback` → returns JWT → CLI stores token locally
2. **Chat:** CLI sends messages to `POST /chat/submit` with JWT → server validates auth + credits → streams AI response with tool calls → saves session to DB → ingests usage to Polar
3. **Tool execution:** Tool calls returned by the server are executed *locally* in the CLI (in BUILD mode), results sent back to server for next LLM turn

### CLI (`packages/cli/src/`)

- **Entry point:** `index.tsx` — bootstraps React app with OpenTUI renderer
- **Routing:** Three screens via React Router: `Home` (session list), `NewSession`, `Session` (chat)
- **`hooks/use-chat.ts`** — core hook driving AI streaming via `@ai-sdk/react`
- **`lib/local-tools.ts`** — PLAN/BUILD tool implementations (readFile, writeFile, editFile, bash, etc.)
- **`lib/api.ts`** — typed API client wrapping server endpoints
- **`providers/`** — dialog, keyboard, prompt config, theme, toast state managers

### Server (`packages/server/src/`)

- **Entry point:** `index.ts` — Hono app with route groups: `/auth`, `/billing`, `/sessions`, `/chat`
- **Middleware:** `auth.ts` verifies JWT; `credits.ts` checks Polar balance before each chat request
- **`routes/chat.ts`** — main LLM orchestration: system prompt construction, AI SDK streaming, tool call dispatch, credit ingestion
- **`lib/`** — model lookup, Polar SDK integration, credits calculation, auth verification

### Shared (`packages/shared/src/`)

- **`models.ts`** — supported model registry with pricing (default: `claude-opus-4-6`)
- **`schemas.ts`** — Zod schemas for tool contracts; defines which tools are available in PLAN vs BUILD mode

### Database (`packages/database/`)

Single Prisma model:
```prisma
model Session {
  id        String   @id @default(cuid())
  userId    String
  title     String
  messages  Json     @default("[]")   // full message history serialized
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Uses `@prisma/adapter-pg` for edge-compatible connections. Production DB is Neon (PostgreSQL).

## Key Design Decisions

- **Two operational modes:** PLAN (read-only tools) and BUILD (write/edit/bash tools). The shared package exports separate tool sets for each.
- **Local tool execution:** AI tool calls are streamed to the CLI and executed client-side, not server-side, so the server never touches the user's filesystem.
- **Credits system:** Each chat request checks Polar credit balance first (middleware), then ingests token usage as a credit event after the response completes.
- **Message history in JSON:** Full conversation history is stored as a JSON blob on the `Session` model rather than normalized rows.

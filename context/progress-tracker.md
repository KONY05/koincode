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

## Recently Completed (Phase 2 — continued)

- **Context management** — `/context` command opens a modal showing tokens used vs. model context window (single bar, exact from API usage data). `/compact` command summarizes the conversation via the AI, stores a `compact_boundary` marker server-side, and resets the LLM context to just the summary + new messages — old messages remain visible in the transcript with a "Context compacted" divider. Status bar shows a 10-segment dot ring (`●●●●●●●●○○`) when usage ≥ 80%, turning red at 95%. Auto-compaction triggers automatically at 90% between responses. `getContextWindow(modelId)` added to `@koincode/shared` with per-model sizes for all supported models. `contextUsage` (tokensUsed, contextWindow, percent) exposed from `useChat` and threaded through SessionShell → InputBar → StatusBar. New server route `POST /sessions/:id/compact`; chat boundary scan now recognizes both `clear_boundary` and `compact_boundary`. Feature spec: `context/feature-specs/21-context-management.md`.

- **Voice input** — `/voice` command toggles voice input mode on/off (persisted to `~/.koincode/config.json`). When enabled, holding Space starts recording and releasing stops it; the transcript is appended at the cursor. A short Space press still inserts a normal space. Transcription backend auto-selects: OpenAI Whisper API when an `openai` key is present, otherwise `@xenova/transformers` (local WASM, zero system deps, one-time model download to `~/.koincode/whisper/`). Audio recording uses platform-native tools: `sox` on macOS, `arecord` on Linux, PowerShell MCI on Windows. Status bar shows a `voice` indicator while active. Config fields added: `voiceInput`, `whisperModel` (`tiny`/`base`/`small`), `whisperBackend` (`auto`/`openai`/`local`). New files: `packages/cli/src/lib/whisper.ts`, `packages/cli/src/lib/voice-recorder.ts`.

- **Skills system** — Command menu extended with skills: reusable task instructions the agent reads and executes. Each skill is a directory (`SKILL.md` + optional `scripts/`, `references/`, `assets/`) stored at `.koincode/skills/` (project-local) or `~/.koincode/skills/` (global). Two built-in skills shipped: `code-review` and `git-commit`. The skills manifest is injected into the system prompt on every request so the agent knows what's available. Two new tools: `readSkill` (PLAN+BUILD — reads SKILL.md and directory listing, or a specific sub-file with path-traversal guard) and `writeSkill` (BUILD-only — creates or updates SKILL.md, detects create vs. update, preserves existing sub-directories). Skills appear in the command menu alongside built-in commands; selecting one triggers an immediate agent turn. Works from both the home screen (creates a new session) and inside an existing session. Agent can also create/update skills on request via `writeSkill`. Files: `packages/cli/src/lib/skills.ts`, `packages/cli/src/skills/builtins.ts`, `packages/cli/src/tools/read-skill.ts`, `packages/cli/src/tools/write-skill.ts`.

## Recently Completed

- **Local model support** — Users can now chat with locally-running models (Ollama, LM Studio, vllm, or any OpenAI-compatible endpoint). `GET /local-models` on the server auto-detects Ollama at `localhost:11434` and returns pulled models alongside user-configured custom endpoints. The model picker gains a third "Local" tab (Tab to cycle) that fetches and lists discovered models with file size hints. Model IDs use an `ollama/<name>` or `local/<name>` prefix convention. `resolveChatModel` in the server handles both by wiring `createOpenAI` with the appropriate `baseURL`. `ollamaBaseURL` (and `localModels`) added to `KoincodeGlobalConfig` for users with non-default Ollama URLs. The model type throughout the CLI was broadened from `SupportedChatModelId` to `string` to accommodate arbitrary local model IDs.

- **Tool refactor** — `packages/cli/src/lib/local-tools.ts` split into `packages/cli/src/tools/` with one file per tool (`read-file.ts`, `list-directory.ts`, `glob.ts`, `grep.ts`, `write-file.ts`, `edit-file.ts`, `bash.ts`). Shared helpers/constants live in `tools/utils.ts`. `tools/index.ts` exports `executeLocalTool` with the same switch-based dispatch. Import in `hooks/use-chat.ts` updated; old `lib/local-tools.ts` deleted.
- **Tool call styling** — `editFile` now renders a diff view: removed lines in red with `- ` prefix, added lines in green with `+` prefix, capped at 8 lines per side with truncation notices. `writeFile` shows a file creation preview: header with path + first 3 lines of content (dimmed), with `…` if the file has more. Both components show a ` …` spinner while the tool is pending and surface error text if the call fails. All other tools retain the existing plain-text display. Change is in `packages/cli/src/components/messages/bot-message.tsx`.
- **Permission / approval system** — When the agent calls `shell`, `writeFile`, or `editFile`, the CLI intercepts the tool call before execution and replaces the input bar with an approval widget. The user picks Allow once, Allow for project (persisted to `.koincode/config.json`), or Deny. Deny sends `{ denied: true }` back to the model. Routine file writes inside the project are auto-allowed; sensitive paths (`.env`, `*.pem`, `.git/config`, `.github/workflows/**`, etc.) always require approval. Shell commands are grouped by binary into typed permission keys (`shell:git`, `shell:npm`, `shell:rm`, `shell:write`, `shell:unknown`) with destructive-tier visual indicators. Concurrent tool-call approvals are serialized via a shared Promise mutex. Implemented in `packages/cli/src/lib/permissions.ts`, `packages/cli/src/lib/project-config.ts`, and `packages/cli/src/components/approval-widget.tsx`.
- **`askUser` tool** — Model-initiated question tool available in both PLAN and BUILD modes. The model calls `askUser({ question, options, allowFreeText })` mid-task to ask the user a multi-option question. The same input-bar slot renders `AskUserWidget` with arrow key / number shortcut navigation and an optional free-text input mode. The user's selected value (or `{ cancelled: true }`) is returned as the tool result. Uses the same shared mutex as the permission system so approvals and questions are never shown simultaneously. Schema in `packages/shared/src/schemas.ts`; widget in `packages/cli/src/components/ask-user-widget.tsx`.
- **Typecheck script** — `bun run typecheck` added to root `package.json`. Runs `tsc --noEmit` across `packages/shared`, `packages/cli`, and `packages/server` in sequence.

## Next Up

### Phase 2 — Local-First Pivot

- **P2-F01:** ✅ Done. Removed Clerk auth middleware, all auth routes, Polar billing middleware and billing routes. Removed `@clerk/backend` and `@polar-sh/sdk` dependencies. Removed all `userId` references from routes, schema, and generated Prisma client. Server is now unauthenticated — all endpoints accessible from localhost only. Removed `/login`, `/logout`, `/upgrade`, `/usage` CLI commands.
- **P2-F02:** ✅ Done. Swapped `@prisma/adapter-pg` → `@prisma/adapter-better-sqlite3`. Schema changed to `provider = "sqlite"`. DB path: `~/.config/koincode/data.db`. Initial migration generated at `packages/database/prisma/migrations/`. `prisma.config.ts` now computes the path dynamically (no `.env` required for DB). Server runs `prisma migrate deploy` on startup. CLI spawns the server on first run via `server-manager.ts` — health-check at `/health`, polls until ready, restarts on `ECONNREFUSED`. Server auto-shuts after 30 min of idle, CLI restarts it transparently. Port updated from 3000 → 37420 everywhere.
- **P2-F03 + P2-F04:** ✅ Done. OpenRouter integration and multi-provider key support implemented together. Keys stored in `~/.koincode/config.json` (`KoincodeGlobalConfig` type in `@koincode/shared`). CLI reads config and passes keys as env vars when spawning the server. Server model resolver checks for a direct provider key first (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and falls back to OpenRouter (`OPENROUTER_API_KEY`) for any model whose native key is absent. `/setup` command opens a dialog with rows for OpenRouter, Anthropic, OpenAI, and Gemini keys — navigate with ↑↓, Enter to edit, Esc to cancel/close. Keys can also be saved non-interactively: `koincode --openrouter-key sk-xxx`, `--anthropic-key`, `--openai-key`, `--gemini-key`.
- **P2-F05:** Update server port from 3000 → 37420 across server config, `API_URL` default, and CLAUDE.md.
- **P2-F06:** ✅ Done. `Memory` model added to Prisma schema (`id`, `content`, `createdAt`, `updatedAt`). Migration `20260529172100_add_memory` created and applied. CRUD routes at `/memory` (GET list, POST create, PATCH `:id`, DELETE `:id`). Chat route fetches all memories on each request and passes concatenated content to `buildSystemPrompt` as `userMemory`. System prompt injects a `# Remembered Context` section when memories exist. Memory tool calls (so the agent can manage memory itself) are deferred — see Deferred section.
- **Memory tool calls** — Expose the memory CRUD routes as agent tool calls (add, update, delete, list) so the AI can manage user memory directly during a session. Routes and DB table are already implemented; only the tool contracts and CLI-side execution handlers need to be added.

## Deferred (Future Implementation)

These were scoped out and should be revisited:

- **`koincode install <skill>`** — Wrap npm install to pull skills published as npm packages (naming convention: `@koincode-skills/<name>`). The install command would fetch the package and extract its files into `~/.koincode/skills/<name>/`. Also consider a GitHub shorthand (`koincode install github:user/my-skill`). No custom registry needed — npm is the registry. Requires `koincode install` CLI subcommand.

- **Compression prompt** — Implement context window compression. When conversation length approaches the model's limit, summarize completed work into a structured continuation prompt (original goal, completed actions, current state, remaining tasks, next step, key context) and replace the history. Prevents context overflow mid-task.
- **Hooks tool call extension** — Right now the executeHook method in `packages/shared/src/index.ts` only work with `command` type to execute hooks, we will later extend it to handle other hook types: `http`, `mcpTool`, `prompt`, and `agent`.

## Open Questions

- None.

## Architecture Decisions

- **Always slice before sending to the model** — Any server route that sends message history to an LLM must first call `getLastBoundaryIndex(messageRecords)` and slice from that index + 1. This ensures the model only sees the current context window (post-clear or post-compact). Applied consistently in `chat.ts` (live stream), `sessions.ts` compact, and `sessions.ts` handoff. `getLastBoundaryIndex` lives in `lib/helpers.ts`.

- Bun workspaces monorepo — four packages: cli, server, database, shared.
- OpenTUI + React 19 for terminal rendering (not Ink).
- Tool calls executed client-side in the CLI; server only orchestrates the AI turn.
- Provider resolution is model-driven: the model the user selects determines which key is used. Direct provider keys (Anthropic, OpenAI, Gemini) take priority when the model maps to that provider; OpenRouter is the fallback for any model without a matching direct key.
- Config stored globally at `~/.koincode/config.json` — holds provider keys and user preferences, shared across all projects.
- Project-specific config stored at `.koincode/config.json` — holds project-level hooks and permissions.
- Hooks support both global and project scopes: global hooks apply to all projects, project hooks override global hooks for the current project.
- Message history stored as a JSON blob on the Session row rather than normalized message rows.
- PLAN mode and BUILD mode share the same session; mode is selected at session creation and controls which tools are exposed to the model.

## Session Notes

- Bun as package manager and runtime throughout (no Node/npm).
- React 19.2.4, React Router 7, Zod 4, Hono 4, AI SDK 6.
- Default model: `claude-opus-4-6` (will become an OpenRouter model in Phase 2).
- Production DB was Neon PostgreSQL — being replaced with local SQLite in Phase 2.
- Port changing from 3000 → 37420 in Phase 2 to avoid common port conflicts.

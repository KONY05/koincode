# KOINCODE

## Overview

KOINCODE is a local-first, open-source terminal AI coding agent. It runs entirely on the user's machine — the CLI, the server (a local Bun process), and the database (SQLite) are all local with no cloud dependency. Users bring their own AI model keys and interact with AI models directly from their terminal, similar to how opencode works.

## Goals

1. Let users run a fully local AI coding agent with zero cloud accounts required beyond an AI provider key.
2. Support OpenRouter as the primary model gateway so users can access any open-source or frontier model through a single key.
3. Support existing provider keys (Anthropic, OpenAI, Gemini) so users can continue using active subscriptions without needing OpenRouter.
4. Provide PLAN mode (read-only analysis) and BUILD mode (full file editing and bash execution) for safe, staged AI-assisted development.
5. Persist conversation history locally in SQLite sessions.
6. Keep the tool open-source and self-hostable with no mandatory external services.
7. Optionally bridge to KOINCODE-Review (a separate, hosted code-review product) via a `/review` command family, so a user who wants automated PR reviews doesn't have to leave the terminal to connect a repo — entirely opt-in, no impact on the core local-first flow if unused.

## Core User Flow

1. User installs KOINCODE globally via `bun link` or a package manager.
2. User runs `koincode` in their terminal.
3. On first launch, user enters their AI provider key (OpenRouter, Anthropic, OpenAI, or Gemini).
4. User creates a new session or resumes an existing one.
5. User selects PLAN or BUILD mode and types a prompt.
6. The CLI sends the message to the local Hono server, which calls the AI model.
7. The server streams tool calls back to the CLI.
8. In PLAN mode, the CLI executes read-only tools (readFile, listDirectory, glob, grep).
9. In BUILD mode, the CLI also executes write tools (writeFile, editFile, bash).
10. Tool results are sent back to the server for the next model turn.
11. The completed conversation is saved to the local SQLite session.

## Features

### Model Access

- OpenRouter integration as the default model gateway — supports any open-source or frontier model available on OpenRouter.
- Direct provider key support: users with an Anthropic, OpenAI, or Gemini key can input it and KOINCODE routes requests to the correct provider automatically.
- Key detection maps the key format to the right provider (e.g. `sk-ant-*` → Anthropic, `sk-*` → OpenAI, `AIza*` → Gemini).

### PLAN / BUILD Modes

- **PLAN mode:** read-only tool set (readFile, listDirectory, glob, grep) for safe codebase analysis without modifications.
- **BUILD mode:** full tool set adding writeFile, editFile, and bash execution for implementation tasks.
- Mode is selected per session and visible in the terminal UI at all times.

### Sessions

- Each conversation is a persistent session stored in a local SQLite database.
- Sessions store the full message history as a JSON blob.
- Users can list, resume, and navigate between sessions from the home screen.

### Terminal UI

- React 19 with OpenTUI for a native terminal rendering experience.
- Three screens: Home (session list), New Session, Session (active chat).
- Streaming AI responses rendered in real time.

### Local Server

- A lightweight Hono server runs as a local Bun process on port 37420.
- Handles AI model orchestration, system prompt construction, and tool call streaming.
- Communicates with the CLI over localhost — no network exposure required.

### Review Integration (optional)

- `/review login`, `/review connect`, `/review disconnect`, `/review status`, `/review open` — pairs the CLI with a KOINCODE-Review account via a browser-based device-auth flow and connects/disconnects the current repo for automated PR reviews, without leaving the terminal.
- Entirely opt-in: nothing in this section runs unless the user invokes a `/review` command, and it makes outbound calls only to the Review API, never to the local server or database.
- See `context/feature-specs/42-koincode-review-integration.md`.

## Scope

### In Scope

- Fully local operation: CLI + server + SQLite all on the user's machine
- OpenRouter key support for any open-source or frontier model
- Direct Anthropic, OpenAI, and Gemini key support mapped to their respective provider
- PLAN mode (read-only tools) and BUILD mode (write/edit/bash tools)
- Persistent local SQLite sessions with full message history
- Streaming AI responses with tool calling
- Terminal UI with session management

### Out of Scope

- Cloud-hosted server or database for KOINCODE itself
- User authentication for using KOINCODE (Clerk or any OAuth flow) — the local server stays unauthenticated and single-user. This does not cover the opt-in `/review` commands' pairing with the separate KOINCODE-Review product, which is client-side-only from KOINCODE's perspective (an HTTPS API call, same category as the existing update-checker's npm registry fetch) and adds no auth to the local server or database.
- Credit-based billing (Polar or any metering system)
- SaaS or multi-tenant deployment
- Mobile or web clients

## Success Criteria

1. A user can install KOINCODE locally and start chatting with an AI model using only their own API key.
2. OpenRouter key grants access to any model available on the platform.
3. A user with an existing Anthropic, OpenAI, or Gemini key can use it without needing OpenRouter.
4. PLAN mode never modifies the filesystem; BUILD mode can read and write files and run bash commands.
5. Sessions persist across restarts and can be resumed from the home screen.
6. The entire stack (CLI, server, database) runs on the user's machine with no external services required.

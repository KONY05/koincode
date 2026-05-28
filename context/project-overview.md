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

- Cloud-hosted server or database
- User authentication (Clerk or any OAuth flow)
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

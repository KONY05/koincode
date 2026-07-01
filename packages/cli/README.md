# koincode

An open source local-first terminal coding agent. Peer programming with any frontier model or local/free models to run agentic development directly in your terminal with two modes — **PLAN** (read-only analysis) and **BUILD** (full file editing and bash execution).

No auth. No billing. Bring your own API keys.

## Installation

One command, no dependencies — no Bun or Node runtime required at execution time:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/KONY05/koincode/main/install.ps1 | iex
```

Or install via npm — this pulls down a prebuilt native binary for your platform (no Bun needed):

```bash
npm i -g koincode
```

Also works with other package managers:

```bash
bun i -g koincode
pnpm i -g koincode
yarn global add koincode
```

Or download a binary directly from [GitHub Releases](https://github.com/KONY05/koincode/releases/latest).

## Setup

Add your API keys directly from the command line:

```bash
koincode --anthropic-key <your-key>
koincode --openai-key <your-key>
koincode --gemini-key <your-key>
koincode --openrouter-key <your-key>
```

Or run `koincode` and use `/setup` from the in-app command menu to add keys interactively.

## Usage

```bash
koincode
```

This opens the terminal UI. From there you can:

- Start a new session or resume a previous one
- Switch between **PLAN** mode (reads files, no writes) and **BUILD** mode (edits files, runs bash)
- Stream responses from your chosen AI model in real time

## Supported Models

- Claude (Anthropic) — default: `claude-sonnet-5`
- GPT (OpenAI)
- Gemini (Google)
- OpenRouter — including free models
- Local models via Ollama

## How It Works

koincode runs a local server in the background (port 37420 by default) that handles AI orchestration and session persistence. The terminal UI connects to it and executes any tool calls — file reads, writes, edits, bash — locally on your machine.

The server never touches your filesystem. All tool execution happens client-side.

## Optional: Browser Tools

Browser tools (automated testing via Playwright) are opt-in:

```bash
koincode --enable-browser-tools   # Detects Chrome or prompts to download Chromium
koincode --disable-browser-tools
```

Or use `/enable-browser-tools` from the command menu inside a session.

## Custom Port

```bash
koincode --port 8080
```

The server defaults to port 37420 if not specified.

## Updating

```bash
koincode --update
```

Works regardless of how koincode was installed (curl, npm, or a package manager) — it detects the install method and updates in place.

## All Flags

```bash
koincode --help
```

Prints the full list of flags (keys, port, browser tools, update, version).

## Open Source

MIT licensed. Contributions welcome.

[GitHub](https://github.com/KONY05/koincode)

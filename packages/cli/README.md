# koincode

An open source local-first terminal coding agent. Peer programming with any frontier model or local/free models to run agentic development directly in your terminal with two modes — **PLAN** (read-only analysis) and **BUILD** (full file editing and bash execution).


No auth. No billing. Bring your own API keys.

## Requirements

- [Bun](https://bun.sh) v1.0 or later

## Installation

```bash
npm install -g koincode
```

## Setup

Add your API keys via the built-in config command:

```bash
koincode config set anthropic <your-key>
koincode config set openai <your-key>
```

## Usage

```bash
koincode
```

This opens the terminal UI. From there you can:

- Start a new session or resume a previous one
- Switch between **PLAN** mode (reads files, no writes) and **BUILD** mode (edits files, runs bash)
- Stream responses from your chosen AI model in real time

## Supported Models

- Claude (Anthropic) — default: `claude-opus-4-6`
- GPT (OpenAI)
- Gemini (Google)
- OpenRouter

## How It Works

koincode runs a local server in the background (port 37420 by default) that handles AI orchestration and session persistence. The terminal UI connects to it and executes any tool calls — file reads, writes, edits, bash — locally on your machine.

The server never touches your filesystem. All tool execution happens client-side.

## Custom Port

```bash
koincode --port 8080
```

## Open Source

MIT licensed. Contributions welcome.

[GitHub](https://github.com/KONY05/koincode)

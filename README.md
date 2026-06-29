<div align="center">

<br />

<img src="./assets/koincode.png" alt="KOINCODE" width="320" />

<br />

<p>A local-first terminal AI coding agent.</p>

<p>Plan, chat, and build inside your local project with a Bun-powered CLI, Hono API, SQLite database, OpenRouter integration, and AI SDK streaming.</p>

<br />

<p>
  <a href="https://cwa.run/bun?utm_source=github&utm_medium=readme&utm_campaign=koincode&utm_content=badge_bun"><img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" /></a>&nbsp;
  <a href="https://cwa.run/opentui?utm_source=github&utm_medium=readme&utm_campaign=koincode&utm_content=badge_opentui"><img src="https://img.shields.io/badge/OpenTUI-111111?style=for-the-badge" alt="OpenTUI" /></a>&nbsp;
  <a href="https://cwa.run/react?utm_source=github&utm_medium=readme&utm_campaign=koincode&utm_content=badge_react"><img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" /></a>&nbsp;
  <a href="https://cwa.run/hono?utm_source=github&utm_medium=readme&utm_campaign=koincode&utm_content=badge_hono"><img src="https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono" /></a>&nbsp;
  <a href="https://cwa.run/sqlite?utm_source=github&utm_medium=readme&utm_campaign=koincode&utm_content=badge_sqlite"><img src="https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" /></a>&nbsp;
  <a href="https://cwa.run/openrouter?utm_source=github&utm_medium=readme&utm_campaign=koincode&utm_content=badge_openrouter"><img src="https://img.shields.io/badge/OpenRouter-000000?style=for-the-badge&logo=openrouter&logoColor=white" alt="OpenRouter" /></a>
</p>

</div>

<br />

## Features

- **Local-first** - CLI, server, and database run entirely on your machine
- **Plan & Build modes** - Read-only analysis or full file editing and shell execution
- **Multi-provider** - OpenRouter, Anthropic, OpenAI, or Gemini keys
- **Persistent sessions** - Local SQLite database stores your conversation history

## Install

One command, no dependencies:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/KONY05/koincode/main/install.ps1 | iex
```

Or download directly from [GitHub Releases](https://github.com/KONY05/koincode/releases/latest).

<details>
<summary>Alternative: install via npm</summary>

```bash
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc && bun i -g koincode
```
</details>

## Getting Started

```bash
koincode --setup        # Configure your API keys
koincode                # Start coding
```

On first run, use `/setup` to add your API keys (OpenRouter, Anthropic, OpenAI, or Gemini).

### Optional: Browser tools

Browser tools (automated testing via Playwright) are opt-in:

```bash
koincode --enable-browser-tools   # Detects Chrome or prompts to download Chromium
```

Or use `/enable-browser-tools` from the command menu inside a session.

### Custom port

```bash
koincode --port 3000
```

The server defaults to port 37420 if not specified.

## Building from source

```bash
git clone https://github.com/KONY05/koincode.git
cd koincode
bun install
bun run dev:cli
```

To build and link the CLI globally:

```bash
bun run link:cli
koincode
```

To build standalone binaries:

```bash
cd packages/cli && COMPILE=true bash bin/build.sh
# Outputs: dist/koincode-darwin-arm64, dist/koincode-darwin-x64, dist/koincode-linux-x64
```

Server logs are available at `~/.koincode/server.log`.

```bash
bun run typecheck
bun run lint
```

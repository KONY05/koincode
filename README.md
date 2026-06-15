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

## Requirements

- [Bun](https://bun.sh) v1.0 or later

```bash
curl -fsSL https://bun.sh/install | bash
```

## Getting Started

```bash
git clone https://github.com/KONY05/koincode.git
cd koincode
bun install
bun run dev:cli
```

On first run, use the `/setup` command to configure your API keys (OpenRouter, Anthropic, OpenAI, or Gemini).

To use a custom port:

```bash
koincode --port 3000
```

The server defaults to port 37420 if not specified.

To build and link the CLI globally:

```bash
bun run link:cli
koincode
```

<!-- ## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a pull request. -->

## Building the repo locally

```bash
# Install dependencies
bun install

# Generate Prisma client
bun run --cwd packages/database db:generate

# Run database migrations
bun run db:migrate

# Start the CLI (server auto-spawns on first run)
bun run dev:cli
```

Server logs are available at `~/.koincode/server.log`.

For development, you can also run type checking and linting:

```bash
bun run typecheck
bun run lint
```

# Feature Spec: MCP Support Integration

## Goal

Extend the agent's capabilities dynamically by connecting to MCP (Model Context Protocol) servers — both local (stdio subprocess) and remote (SSE/HTTP). Primary use cases: Slack, GitHub, databases, and any other MCP-compatible service.

## Architecture Decision

MCP is managed **server-side**. The Hono server (port 37420) runs on the user's local machine, so it can spawn stdio subprocesses and connect to remote SSE servers alike. The CLI needs no changes — it just gets more tools in the LLM's context automatically.

MCP tools are merged with built-in tools on every chat request. Tool names are namespaced as `serverName__toolName` (e.g. `github__create_issue`, `slack__post_message`) to avoid collisions.

## Config Format

Users declare MCP servers in `~/.koincode/config.json` (global) or `.koincode/config.json` (project-level). Project config overrides global for servers with the same name.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": { "SLACK_BOT_TOKEN": "xoxb-...", "SLACK_TEAM_ID": "T..." }
    },
    "my-remote-server": {
      "url": "https://my-server.example.com/sse"
    }
  }
}
```

Format mirrors Claude Desktop's `mcpServers` config for familiarity. Anything that works there works here.

## Phase 1: Core Implementation

### Files changed

**`packages/shared/src/config.ts`**
- Add `McpServerConfig` type:
  ```typescript
  export type McpServerConfig = {
    command?: string;                  // stdio: executable (e.g. "npx")
    args?: string[];                   // stdio: args
    env?: Record<string, string>;      // extra env vars (tokens etc.)
    url?: string;                      // SSE/HTTP: remote server URL
    enabled?: boolean;                 // default true
  };
  ```
- Add `mcpServers?: Record<string, McpServerConfig>` to `KoincodeGlobalConfig`

**`packages/cli/src/utils/configs/project-config.ts`**
- Add `mcpServers?: Record<string, McpServerConfig>` to `ProjectConfig` type

**`packages/server/src/lib/mcp-manager.ts`** (new file)
- Reads `~/.koincode/config.json` and `.koincode/config.json`, merges them
- Connects to each enabled server using `@modelcontextprotocol/sdk`:
  - `StdioClientTransport` for `command`-based servers
  - `SSEClientTransport` for `url`-based servers
- Calls `client.listTools()` on connect, converts to AI SDK tool objects using `jsonSchema()` (accepts raw JSON Schema — no Zod conversion needed) with `execute` functions that call `client.callTool()`
- Keeps connections alive in module-level state for the server process lifetime
- Exports: `initializeMcp()`, `getMcpTools()`, `getMcpServerStatus()`, `shutdownMcp()`
- Non-fatal: if a server fails to connect, logs the error and continues; other servers still work

**`packages/server/src/index.ts`**
- Call `initializeMcp()` after DB migration succeeds (non-fatal on failure)
- Register `shutdownMcp()` on `SIGTERM`

**`packages/server/src/routes/chat.ts`**
- Merge tools at the top of the handler:
  ```typescript
  const tools = { ...getToolContracts(mode), ...getMcpTools() };
  ```
- Use the merged `tools` everywhere `getToolContracts(mode)` currently appears (3 places: `validateUIMessages`, `convertToModelMessages`, `streamText`)

**`packages/server/src/prompts/system-prompt.ts`**
- Pass connected MCP server names/tool counts into the prompt so the agent knows what's available

**`packages/server/package.json`**
- Add `@modelcontextprotocol/sdk` dependency

### Not in Phase 1

These are immediate follow-ons to discuss once core is working:

- **`manageMcp` agent tool** — lets the agent (and user) list connected servers, see their tools, and check connection status. Useful for debugging when tools aren't appearing as expected.
- **MCP status in the CLI status bar** — surface connected server count alongside mode/model in the header or status bar.
- **Per-session MCP permissions** — similar to file/shell permissions: the agent asks before calling an MCP tool for the first time in a session.
- **`manageMcp` tool for adding/removing servers at runtime** — so the agent can wire up a new MCP server mid-session without restarting.
- **`mcp_tool` hook handler type** — the commented-out `mcp_tool` hook type in `schemas.ts` can be unlocked once MCP is live, enabling hooks that trigger MCP tool calls on file edits, shell commands, etc.

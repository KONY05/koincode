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

- **`manageMcp` agent tool** — ✅ Done (Phase 2)
- **MCP status in the CLI status bar** — ✅ Done (Phase 2)
- **Per-session MCP permissions** — ✅ Done (Phase 2)
- **`manageMcp` tool for adding/removing servers at runtime** — deferred
- **`mcp_tool` hook handler type** — deferred

## Phase 2: Permissions, `manageMcp` Tool, and Status Bar

### Overview

Three additions built on top of the Phase 1 core:

1. **Per-session MCP permissions** — first use of any tool from an unapproved server blocks execution and shows an approval widget. Approved servers are tracked in an in-memory `Set` scoped to the current `useChat` instance (cleared on navigation away). The widget offers "Allow for session" (adds to the in-memory set) or "Deny" — no project-level persistence for MCP, since the user already consented by adding the server to `~/.koincode/config.json`.

2. **`manageMcp` read-only tool** — available in both PLAN and BUILD modes. Returns a JSON summary of all configured servers: name, status (`connected`/`error`/`disabled`), tool count, and error message if any. The agent calls this to debug connectivity or report what's available.

3. **MCP server count in the status bar** — connected server count shown as `› N mcp` (dimmed) after the model name. Fetched once on session mount via `GET /mcp/servers`.

### Files changed

**`packages/shared/src/schemas.ts`**
- Added `manageMcp: z.object({})` to `toolInputSchemas`
- Added `manageMcp` to `readOnlyToolContracts` (no `execute` — dispatched client-side)

**`packages/server/src/lib/mcp-manager.ts`**
- Removed `execute` from MCP tool objects (tools now stream to CLI like built-ins)
- Added `callMcpTool(namespacedToolName, args)` export — delegates to `client.callTool()`, returns stringified content
- Transport selection: `StreamableHTTPClientTransport` default for URL servers; `SSEClientTransport` only when `config.transport === "sse"` is set explicitly

**`packages/server/src/routes/mcp.ts`** (new)
- `GET /mcp/servers` — returns `getMcpServerStatus()` array
- `POST /mcp/call` — validates body, calls `callMcpTool`, returns `{ result }`

**`packages/server/src/index.ts`**
- Added `.route("/mcp", mcp)` to the routes chain

**`packages/cli/src/tools/mcp.ts`** (new)
- `runMcpTool(toolName, args)` — POSTs to `/mcp/call`
- `runManageMcp()` — GETs `/mcp/servers`, returns formatted status

**`packages/cli/src/tools/index.ts`**
- Added `manageMcp` case
- Added `if (toolName.includes("__"))` catch-all routing to `runMcpTool`

**`packages/cli/src/utils/permissions/index.ts`**
- Added `` `mcp:${string}` `` to `PermissionKey`
- Added `isMcp?: boolean` to `PendingApproval`
- Added `{ type: "allow-for-session" }` to `ApprovalResponse`

**`packages/cli/src/components/widget/approval-widget.tsx`**
- `isMcp` approval shows `MCP_OPTIONS` (Allow for session / Deny) instead of standard options

**`packages/cli/src/hooks/use-chat.ts`**
- Added `approvedMcpServersRef = useRef<Set<string>>(new Set())`
- MCP gate runs before the standard permission gate for any `toolName.includes("__")` tool call

**`packages/cli/src/components/status-bar.tsx`**
- Added `mcpServerCount?: number` prop; renders `› N mcp` when count > 0

**`packages/cli/src/components/session-shell.tsx`** / **`input-bar.tsx`**
- Threads `mcpServerCount` through to `StatusBar`

**`packages/cli/src/screens/session.tsx`**
- Fetches `GET /mcp/servers` on mount, counts connected servers, passes `mcpServerCount` to `SessionChat` → `SessionShell`


# Hook Type: mcp_tool

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "writeFile",
      "hooks": [{ "type": "mcp_tool", "tool": "slack__post_message", "args": { "channel": "#dev", "text": "File written" } }]
    }]
  }
}
```
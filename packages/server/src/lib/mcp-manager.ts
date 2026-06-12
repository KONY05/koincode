import fs from "fs";
import { jsonSchema, tool, type Tool } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { GLOBAL_CONFIG_FILE, PROJECT_CONFIG_FILE, type McpServerConfig } from "@koincode/shared";
import { logger } from "./helpers";

type McpServerEntry = {
  client: Client;
  tools: Record<string, Tool>;
  status: "connected" | "error" | "disconnected";
  error?: string;
};

// Module-level state: one entry per named server, persisted for the server process lifetime.
const servers = new Map<string, McpServerEntry>();

/**
 * Reads and merges mcpServers from the global (~/.koincode/config.json) and project
 * (.koincode/config.json) config files. Project config takes precedence — if both files
 * declare a server with the same name, the project entry wins.
 */
function readMcpConfigs(): Record<string, McpServerConfig> {
  const merged: Record<string, McpServerConfig> = {};

  for (const configFile of [GLOBAL_CONFIG_FILE, PROJECT_CONFIG_FILE]) {
    try {
      const raw = fs.readFileSync(configFile, "utf8");
      const config = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
      if (config.mcpServers) {
        Object.assign(merged, config.mcpServers);
      }
    } catch {
      // File missing or unparseable — skip silently.
    }
  }

  return merged;
}

/**
 * Creates the appropriate MCP transport for a server config entry:
 * - stdio:           spawns `command` as a subprocess, communicates over stdin/stdout.
 * - streamable HTTP: default for `url`-based servers (current MCP standard).
 * - SSE:             legacy `url`-based transport; opt in with `transport: "sse"`.
 */
function createTransport(
  name: string,
  config: McpServerConfig,
): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
  if (config.command) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...config.env } as Record<string, string>,
    });
  }

  if (config.url) {
    const url = new URL(config.url);
    return config.transport === "sse"
      ? new SSEClientTransport(url)
      : new StreamableHTTPClientTransport(url);
  }

  throw new Error(`MCP server "${name}" has neither command nor url`);
}

/**
 * Connects to a single MCP server, discovers its tools, and stores them as
 * AI SDK-compatible tool objects keyed by `serverName__toolName`.
 *
 * Tool names are namespaced to avoid collisions with KOINCODE's built-in tools.
 * The `execute` function on each tool calls the MCP server at invocation time.
 */
async function connectServer(name: string, config: McpServerConfig): Promise<void> {
  const transport = createTransport(name, config);
  const client = new Client({ name: "koincode", version: "1.0.0" });
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const aiTools: Record<string, Tool> = {};

  for (const mcpTool of mcpTools) {
    const toolName = `${name}__${mcpTool.name}`;

    aiTools[toolName] = tool({
      description: `[${name}] ${mcpTool.description ?? ""}`.trim(),
      // jsonSchema() wraps a raw JSON Schema object for the AI SDK — no Zod conversion needed.
      inputSchema: jsonSchema(
        (mcpTool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      ),
      execute: async (args: Record<string, unknown>) => {
        const result = await client.callTool({ name: mcpTool.name, arguments: args });

        type ContentItem = { type: string; text?: string };

        const content = (result as { content: ContentItem[]; isError?: boolean }).content ?? [];

        const isError = (result as { isError?: boolean }).isError ?? false;

        const text = content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");

        if (isError) return { error: text };

        return text || "(no output)";
      },
    });
  }

  servers.set(name, { client, tools: aiTools, status: "connected" });
  logger.info(`MCP: connected "${name}" — ${mcpTools.length} tool(s)`);
}

/**
 * Reads MCP server configs and connects to all enabled servers in parallel.
 * Called once at server startup. Connection failures are non-fatal — a failed
 * server is recorded with `status: "error"` and the rest still connect normally.
 *
 * @example
 * / ~/.koincode/config.json has:
 * / { "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." } } } }
 *
 * await initializeMcp();
 * / Console: MCP: connected "github" — 26 tool(s)
 * / servers Map now holds: { "github" => { status: "connected", tools: { "github__create_issue": Tool, ... } } }
 */
export async function initializeMcp(): Promise<void> {
  const configs = readMcpConfigs();
  const entries = Object.entries(configs).filter(([, cfg]) => cfg.enabled !== false);

  if (entries.length === 0) return;

  await Promise.all(
    entries.map(async ([name, config]) => {
      try {
        await connectServer(name, config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        servers.set(name, { client: null!, tools: {}, status: "error", error: message });
        
        logger.error(`MCP: failed to connect "${name}": ${message}`);
      }
    }),
  );
}

/**
 * Returns all tools from currently-connected MCP servers as a flat record,
 * ready to be spread into the `tools` parameter of `streamText`.
 *
 * Only tools from servers with `status: "connected"` are included.
 * Errored or disconnected servers contribute nothing.
 *
 * @example
 * getMcpTools()
 * / Returns:
 * / {
 * /   "github__create_issue": Tool,       // description: "[github] Create a new issue"
 * /   "github__list_pull_requests": Tool, // description: "[github] List pull requests"
 * /   "slack__post_message": Tool,        // description: "[slack] Post a message to a channel"
 * /   "slack__list_channels": Tool,       // description: "[slack] List all channels"
 * / }
 * /
 * / Each Tool has: { description, inputSchema (JSON Schema), execute: async (args) => string | object }
 * / The execute fn calls the MCP server and returns the text output or { error: "..." } on failure.
 */
export function getMcpTools(): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const entry of servers.values()) {
    if (entry.status === "connected") {
      Object.assign(result, entry.tools);
    }
  }
  return result;
}

/**
 * Returns a status summary for all configured MCP servers.
 * Used to inject a human-readable overview into the system prompt
 * and expose connection health to callers.
 *
 * @example
 * getMcpServerStatus()
 * / Returns (when github connected, slack failed):
 * / [
 * /   { name: "github", status: "connected", toolCount: 26 },
 * /   { name: "slack",  status: "error",     toolCount: 0, error: "spawn npx ENOENT" },
 * / ]
 * /
 * / Possible status values:
 * /   "connected"    — live, tools available
 * /   "error"        — failed to connect at startup; error field has the reason
 * /   "disconnected" — was connected but client.close() was called (post-shutdown)
 */
export function getMcpServerStatus(): Array<{
  name: string;
  status: string;
  toolCount: number;
  error?: string;
}> {
  return Array.from(servers.entries()).map(([name, entry]) => ({
    name,
    status: entry.status,
    toolCount: Object.keys(entry.tools).length,
    ...(entry.error ? { error: entry.error } : {}),
  }));
}

/**
 * Closes all active MCP client connections and clears the server registry.
 * Called on SIGTERM to allow stdio subprocess cleanup before process exit.
 *
 * @example
 * / Before shutdown: servers Map has 2 entries
 * await shutdownMcp();
 * / Each MCP subprocess (e.g. the npx github server) receives SIGTERM and exits.
 * / servers Map is now empty — getMcpTools() returns {} and getMcpServerStatus() returns [].
 */
export async function shutdownMcp(): Promise<void> {
  await Promise.all(
    Array.from(servers.values()).map(async (entry) => {
      try {
        await entry.client?.close();
      } catch {
        // Ignore cleanup errors — process is exiting anyway.
      }
    }),
  );
  servers.clear();
}

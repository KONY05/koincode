import fs from "fs";
import { jsonSchema, tool, type Tool } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_FILE,
  parseMcpToolName,
  type McpServerConfig,
} from "@koincode/shared";
import { logger } from "./helpers";

type ConfigSource = "global" | "project";

type McpServerEntry = {
  client: Client | null;
  tools: Record<string, Tool>;
  status: "connected" | "error" | "disconnected";
  source: ConfigSource;
  error?: string;
};

// Module-level state: one entry per named server, persisted for the server process lifetime.
const servers = new Map<string, McpServerEntry>();

function configFile(source: ConfigSource): string {
  return source === "global" ? GLOBAL_CONFIG_FILE : PROJECT_CONFIG_FILE;
}

function configDir(source: ConfigSource): string {
  return source === "global" ? GLOBAL_CONFIG_DIR : PROJECT_CONFIG_DIR;
}

/**
 * Reads and merges mcpServers from the global (~/.koincode/config.json) and project
 * (.koincode/config.json) config files. Project config takes precedence — if both files
 * declare a server with the same name, the project entry wins (and its `source` tag
 * reflects that — the global entry underneath is not separately retained).
 */
function readMcpConfigs(): Record<string, McpServerConfig & { source: ConfigSource }> {
  const merged: Record<string, McpServerConfig & { source: ConfigSource }> = {};

  for (const source of ["global", "project"] as const) {
    try {
      const raw = fs.readFileSync(configFile(source), "utf8");
      const config = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
      if (config.mcpServers) {
        for (const [name, cfg] of Object.entries(config.mcpServers)) {
          merged[name] = { ...cfg, source };
        }
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
async function connectServer(name: string, config: McpServerConfig, source: ConfigSource): Promise<void> {
  const transport = createTransport(name, config);
  const client = new Client({ name: "koincode", version: "1.0.0" });
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const aiTools: Record<string, Tool> = {};

  for (const mcpTool of mcpTools) {
    const toolName = `${name}__${mcpTool.name}`;

    // No `execute` — streamed to the CLI for client-side execution and the approval gate.
    aiTools[toolName] = tool({
      description: `[${name}] ${mcpTool.description ?? ""}`.trim(),
      // jsonSchema() wraps a raw JSON Schema object for the AI SDK — no Zod conversion needed.
      inputSchema: jsonSchema(
        (mcpTool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      ),
    });
  }

  servers.set(name, { client, tools: aiTools, status: "connected", source });
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
  const entries = Object.entries(configs);

  if (entries.length === 0) return;

  await Promise.all(
    entries.map(async ([name, config]) => {
      if (config.enabled === false) {
        // Registered (not skipped) so a status query with includeDisabled can see it —
        // just never attempts a connection.
        servers.set(name, { client: null, tools: {}, status: "disconnected", source: config.source });
        return;
      }

      try {
        await connectServer(name, config, config.source);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        servers.set(name, { client: null, tools: {}, status: "error", error: message, source: config.source });

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
 * @param includeDisabled  When false (the default — what the sidebar, status bar, and the
 *   `manageMcp` LLM tool all use), servers with `status: "disconnected"` are omitted, matching
 *   this function's behavior before disabled servers were tracked at all. Pass `true` (the `/mcp`
 *   command does) to see them too.
 *
 * @example
 * getMcpServerStatus()
 * / Returns (when github connected, slack failed, notion disabled):
 * / [
 * /   { name: "github", status: "connected", toolCount: 26, source: "global" },
 * /   { name: "slack",  status: "error",     toolCount: 0,  source: "project", error: "spawn npx ENOENT" },
 * / ]
 * getMcpServerStatus(true)
 * / Also includes: { name: "notion", status: "disconnected", toolCount: 0, source: "global" }
 * /
 * / Possible status values:
 * /   "connected"    — live, tools available
 * /   "error"        — failed to connect at startup; error field has the reason
 * /   "disconnected" — configured but not currently connected: either `enabled: false` in
 * /                    config, or (rarer) a runtime disconnect
 */
export function getMcpServerStatus(includeDisabled = false): Array<{
  name: string;
  status: string;
  toolCount: number;
  source: ConfigSource;
  error?: string;
}> {
  return Array.from(servers.entries())
    .filter(([, entry]) => includeDisabled || entry.status !== "disconnected")
    .map(([name, entry]) => ({
      name,
      status: entry.status,
      toolCount: Object.keys(entry.tools).length,
      source: entry.source,
      ...(entry.error ? { error: entry.error } : {}),
    }));
}

/**
 * Flips a server's `enabled` flag in whichever config file currently declares it (project
 * takes precedence over global, mirroring `readMcpConfigs`'s merge), then connects or
 * disconnects that one server in-process.
 *
 * Deliberately not a reuse of the CLI's `restartServer()` (which restarts KOINCODE's entire
 * local server process — needed for API key changes, since those are only read from env vars
 * at spawn time). MCP connection state lives in this same process as this function and the
 * `/mcp` routes, so a single server can be brought up or down directly with no restart, no
 * dropped AI stream, and no effect on any other MCP server.
 */
export async function setServerEnabled(
  name: string,
  enabled: boolean,
): Promise<{ name: string; status: string; toolCount: number; source: ConfigSource; error?: string }> {
  const config = readMcpConfigs()[name];
  if (!config) throw new Error(`MCP server "${name}" is not configured`);

  const { source, ...serverConfig } = config;
  const file = configFile(source);

  let fileConfig: { mcpServers?: Record<string, McpServerConfig> };
  try {
    fileConfig = JSON.parse(fs.readFileSync(file, "utf8")) as typeof fileConfig;
  } catch {
    fileConfig = {};
  }

  fileConfig.mcpServers = {
    ...fileConfig.mcpServers,
    [name]: { ...fileConfig.mcpServers?.[name], enabled },
  };

  fs.mkdirSync(configDir(source), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fileConfig, null, 2));

  if (enabled) {
    try {
      await connectServer(name, { ...serverConfig }, source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      servers.set(name, { client: null, tools: {}, status: "error", error: message, source });
    }
  } else {
    const entry = servers.get(name);
    try {
      await entry?.client?.close();
    } catch {
      // Ignore close errors — marking it disconnected regardless.
    }
    servers.set(name, { client: null, tools: {}, status: "disconnected", source });
  }

  const updated = servers.get(name)!;
  return {
    name,
    status: updated.status,
    toolCount: Object.keys(updated.tools).length,
    source: updated.source,
    ...(updated.error ? { error: updated.error } : {}),
  };
}

/**
 * Executes a tool call on the named MCP server. Called by the /mcp/call route so
 * the CLI can forward tool calls received from the LLM stream.
 *
 * @param namespacedToolName  e.g. "filesystem__read_file"
 * @param args                The tool arguments from the LLM call
 */
export async function callMcpTool(
  namespacedToolName: string,
  args: unknown,
): Promise<string | { error: string }> {
  const { server: serverName, tool: toolName } = parseMcpToolName(namespacedToolName);
  const entry = servers.get(serverName);

  if (!entry || entry.status !== "connected" || !entry.client) {
    return { error: `MCP server "${serverName}" is not connected` };
  }

  const result = await entry.client.callTool({
    name: toolName,
    arguments: args as Record<string, unknown>,
  });

  type ContentItem = { type: string; text?: string };

  const content = (result as { content: ContentItem[]; isError?: boolean }).content ?? [];

  const isError = (result as { isError?: boolean }).isError ?? false;

  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");

  if (isError) return { error: text };
  
  return text || "(no output)";
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

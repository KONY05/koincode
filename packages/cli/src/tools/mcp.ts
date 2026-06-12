import { fetchWithRestart } from "../lib/api-client";
import { SERVER_PORT } from "@koincode/shared";

const BASE_URL = `http://localhost:${SERVER_PORT}`;

/** Forwards an MCP tool call to the server's /mcp/call endpoint. */
export async function runMcpTool(toolName: string, args: unknown): Promise<unknown> {
  const res = await fetchWithRestart(`${BASE_URL}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolName, args }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MCP call failed (${res.status}): ${text}`);
  }

  const { result } = (await res.json()) as { result: unknown };
  return result;
}

/** Fetches connected MCP server status from the server's /mcp/servers endpoint. */
export async function runManageMcp(): Promise<unknown> {
  const res = await fetchWithRestart(`${BASE_URL}/mcp/servers`);

  if (!res.ok) {
    throw new Error(`Failed to fetch MCP server status (${res.status})`);
  }

  return res.json();
}

const SEP = "__";

/** Splits "serverName__toolName" into { server, tool }. Returns server: "" if no separator. */
export function parseMcpToolName(namespacedName: string): { server: string; tool: string } {
  const idx = namespacedName.indexOf(SEP);
  if (idx === -1) return { server: "", tool: namespacedName };
  return { server: namespacedName.slice(0, idx), tool: namespacedName.slice(idx + SEP.length) };
}

/** Returns true when toolName follows the "serverName__toolName" MCP namespace convention. */
export function isMcpTool(toolName: string): boolean {
  return toolName.includes(SEP);
}

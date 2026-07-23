import { useEffect, useState } from "react";
import type { InferResponseType } from "hono/client";

import { apiClient } from "../lib/api-client";

export type McpServerStatus = InferResponseType<
  typeof apiClient.mcp.servers.$get,
  200
>[number];

type UseMcpServersOptions = {
  /** Include disabled servers in the result. Defaults to false — matches the server's default. */
  includeDisabled?: boolean;
};

// Every useMcpServers() instance fetches once on mount with no shared state — the status bar,
// the sidebar, and the /mcp dialog each hold their own independent copy. Mutating a server via
// setMcpServerEnabled only updates the caller's own copy directly; the others would otherwise
// stay stale until they happened to remount. This is a flat "something changed, refetch"
// broadcast (not keyed, unlike background-process-status.ts's per-PID subscriptions — every
// mounted instance needs to know regardless of its own includeDisabled option) so every live
// instance refetches right away instead of drifting out of sync with what's actually connected.
const changeListeners = new Set<() => void>();

function notifyMcpServersChanged(): void {
  for (const listener of changeListeners) listener();
}

export function useMcpServers(options?: UseMcpServersOptions): McpServerStatus[] {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const includeDisabled = options?.includeDisabled ?? false;

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const res = await apiClient.mcp.servers.$get({
          query: includeDisabled ? { includeDisabled: "true" } : {},
        });
        if (!res.ok) return;
        setServers(await res.json());
      } catch {
        // non-fatal
      }
    };

    void fetchServers();
    changeListeners.add(fetchServers);
    return () => {
      changeListeners.delete(fetchServers);
    };
  }, [includeDisabled]);

  return servers;
}

/** Flips a server's `enabled` flag and reconnects/disconnects it in-process. Throws on failure. */
export async function setMcpServerEnabled(
  name: string,
  enabled: boolean,
): Promise<McpServerStatus> {
  const res = await apiClient.mcp.servers[":name"].enabled.$post({
    param: { name },
    json: { enabled },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && "error" in body ? body.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  const status = await res.json();
  notifyMcpServersChanged();
  return status;
}

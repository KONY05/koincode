import { useEffect, useState } from "react";
import type { InferResponseType } from "hono/client";

import { apiClient } from "../lib/api-client";

export type McpServerStatus = InferResponseType<
  typeof apiClient.mcp.servers.$get,
  200
>[number];

export function useMcpServers(): McpServerStatus[] {
  const [servers, setServers] = useState<McpServerStatus[]>([]);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const res = await apiClient.mcp.servers.$get();
        if (!res.ok) return;
        setServers(await res.json());
      } catch {
        // non-fatal
      }
    };
    void fetchServers();
  }, []);

  return servers;
}

import { hc } from "hono/client";

import type { AppType } from "@koincode/server";
import { SERVER_PORT } from "@koincode/shared";
import { restartServer } from "./server-manager";

const BASE_URL = `http://localhost:${SERVER_PORT}`;

export const apiClient = hc<AppType>(BASE_URL);

// Wraps a fetch call with a single restart-and-retry on connection refused.
// Use this for any request where the server may have gone idle and shut down.
export async function fetchWithRestart(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    const isConnRefused =
      err instanceof TypeError &&
      (err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed") ||
        err.message.includes("Connection refused"));

    if (!isConnRefused) throw err;

    await restartServer();
    return fetch(input, init);
  }
}

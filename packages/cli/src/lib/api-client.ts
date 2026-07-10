import { hc } from "hono/client";

import type { AppType } from "@koincode/server";
import { SERVER_PORT } from "@koincode/shared";
import { restartServer } from "./server-manager";

const BASE_URL = `http://localhost:${SERVER_PORT}`;

// Every apiClient call goes through fetchWithRestart (below) — the local server can die between
// requests (crash, hot-reload hiccup, killed process) with nothing else watching it, so every
// call needs the same restart-and-retry safety net, not just the ones that happened to opt in.
export const apiClient = hc<AppType>(BASE_URL, { fetch: fetchWithRestart });

// Bun's own fetch throws a plain Error (not a TypeError) with code "ConnectionRefused" and
// message "Unable to connect. Is the computer able to access the url?" — not a TypeError and not
// any of the Node/undici strings ("ECONNREFUSED", "fetch failed") this used to look for. That
// mismatch meant the check below never actually matched under Bun, so fetchWithRestart silently
// never restarted anything — every call just re-threw the original error. Checking `code` first
// (Bun's shape, plus undici's `cause.code`) and keeping the message substrings only as a fallback
// makes this work regardless of exactly which fetch implementation is running.
function isConnectionRefused(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const code = (err as { code?: unknown }).code;
  if (code === "ConnectionRefused" || code === "ECONNREFUSED") return true;

  const causeCode = (err.cause as { code?: unknown } | undefined)?.code;
  if (causeCode === "ECONNREFUSED") return true;

  return (
    err.message.includes("ECONNREFUSED") ||
    err.message.includes("fetch failed") ||
    err.message.includes("Connection refused") ||
    err.message.includes("Unable to connect")
  );
}

// Wraps a fetch call with a single restart-and-retry on connection refused.
// Use this for any request where the server may have gone idle and shut down.
export async function fetchWithRestart(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (!isConnectionRefused(err)) throw err;

    await restartServer();
    return fetch(input, init);
  }
}

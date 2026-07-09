/**
 * Buffers stdout/stderr for servers started via `serverStart`, keyed by PID,
 * so the agent can inspect logs on demand (`checkServerLogs`) while the
 * server keeps running indefinitely. Unlike a backgrounded shell command, a
 * dev server has no "finished" event to hang a one-shot delivery off — this
 * is a pull, not a push. Process-lifetime only, same accepted limitation as
 * the other in-memory registries in this codebase.
 */

const MAX_LOG_CHARS = 20_000;

const buffers = new Map<number, string>();

export function registerServerLogBuffer(pid: number): void {
  buffers.set(pid, "");
}

/** No-op if `pid` isn't tracked (e.g. buffer never registered, or predates a restart). */
export function appendServerLog(pid: number, chunk: string): void {
  const existing = buffers.get(pid);
  if (existing === undefined) return;

  const next = existing + chunk;
  // Keep the tail — the most recent output is what matters for diagnosing a
  // live server, same reasoning as the backgrounded-shell delivery text.
  buffers.set(
    pid,
    next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next,
  );
}

export function getServerLog(pid: number): string | undefined {
  return buffers.get(pid);
}

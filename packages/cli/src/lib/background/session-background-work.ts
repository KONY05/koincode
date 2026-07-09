/**
 * Tracks cancellable background work per session — backgrounded shell
 * processes (`shell` with run_in_background) and backgrounded sub-agents
 * (`spawnAgent` with runInBackground) — so it can all be torn down when the
 * session unmounts instead of running unattended indefinitely, burning
 * tokens/resources on work nobody can see the result of anymore.
 */

type CancelFn = () => void;

const bySession = new Map<string, Set<CancelFn>>();

/**
 * Registers a cancel callback for a session. Returns a deregister function —
 * always call it once the work settles on its own, so the set doesn't
 * accumulate callbacks for long-finished work over a long session.
 */
export function registerBackgroundWork(sessionId: string, cancel: CancelFn): () => void {
  let set = bySession.get(sessionId);
  if (!set) {
    set = new Set();
    bySession.set(sessionId, set);
  }
  set.add(cancel);

  return () => {
    bySession.get(sessionId)?.delete(cancel);
  };
}

export function cancelAllBackgroundWork(sessionId: string): void {
  const set = bySession.get(sessionId);
  if (!set) return;
  for (const cancel of set) {
    try {
      cancel();
    } catch {
      // Best-effort — one failed cancellation shouldn't block the rest.
    }
  }
  bySession.delete(sessionId);
}

/**
 * Cancels background work across every session that still has any
 * registered — for app-wide teardown (`/exit`), which calls `process.exit()`
 * directly and never unmounts the Session screen component, so the normal
 * per-session cleanup effect (which calls `cancelAllBackgroundWork` on
 * unmount) never runs. Without this, `process.exit()` just orphans any
 * backgrounded shell process (reparented, left running) and abandons any
 * in-flight background sub-agent request — neither gets killed by the
 * parent process exiting, since `Bun.spawn` children aren't attached to a
 * process group that a plain `process.exit()` signals.
 */
export function cancelAllRegisteredWork(): void {
  for (const sessionId of [...bySession.keys()]) {
    cancelAllBackgroundWork(sessionId);
  }
}

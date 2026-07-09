/**
 * Tracks whether a backgrounded shell PID (`shell` with run_in_background)
 * has exited yet — purely for display, so ShellView can stop showing its
 * "pid NNNN" spinner once the process is actually done. The tool call itself
 * only ever returns once, at spawn time, with no way to update afterward;
 * this is the side channel that fills that gap. Process-lifetime only, same
 * accepted limitation as the other in-memory registries in this codebase.
 */

type ProcessStatus = { exited: boolean; exitCode?: number };
export type ProcessStatusOrUnknown = ProcessStatus | "unknown";

const statuses = new Map<number, ProcessStatus>();
const listeners = new Map<number, Set<(status: ProcessStatus) => void>>();

export function registerBackgroundProcess(pid: number): void {
  statuses.set(pid, { exited: false });
}

export function markProcessExited(pid: number, exitCode: number): void {
  const status: ProcessStatus = { exited: true, exitCode };
  statuses.set(pid, status);

  const subs = listeners.get(pid);
  if (!subs) return;
  listeners.delete(pid);
  for (const listener of subs) listener(status);
}

export function getProcessStatus(pid: number): ProcessStatus | undefined {
  return statuses.get(pid);
}

/**
 * Subscribe to a backgrounded PID exiting. A PID can be in one of three
 * states, and each is reported through `listener` rather than returned
 * directly, so callers (e.g. a React effect) never need to branch and call
 * setState themselves — they just subscribe once:
 * - Untracked (`statuses.get(pid)` is `undefined`): this process never
 *   registered the PID, so it must predate a restart — reported as
 *   `"unknown"` right away, since no markProcessExited() call is ever coming.
 * - Already exited: reported right away with the real status.
 * - Still running: `listener` fires later, whenever markProcessExited runs.
 *
 * The first two cases fire on the next microtask rather than synchronously,
 * so `listener` always runs later, the same as the third case — a caller
 * never has to special-case "did this fire now or later."
 *
 * Returns an unsubscribe function.
 */
export function onProcessExited(
  pid: number,
  listener: (status: ProcessStatusOrUnknown) => void,
): () => void {
  const existing = statuses.get(pid);

  if (existing === undefined) {
    queueMicrotask(() => listener("unknown"));
    return () => {};
  }

  if (existing.exited) {
    queueMicrotask(() => listener(existing));
    return () => {};
  }

  let subs = listeners.get(pid);
  if (!subs) {
    subs = new Set();
    listeners.set(pid, subs);
  }
  subs.add(listener);

  return () => {
    listeners.get(pid)?.delete(listener);
  };
}

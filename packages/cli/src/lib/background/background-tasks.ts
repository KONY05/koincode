/**
 * In-memory registry for background work started this session — sub-agents
 * spawned with runInBackground: true, and shell commands run with
 * run_in_background: true. Process-lifetime only — does not survive a CLI
 * restart, same accepted limitation as the scheduleWakeup timer.
 *
 * Shared shape so scheduleWakeup's waitingOnTaskId and the default-delivery
 * pattern work identically for both kinds of background work — callers don't
 * need to know which kind of task an id belongs to.
 */

export type BackgroundTaskStatus = "running" | "completed" | "error";

export type BackgroundTask = {
  id: string;
  name: string;
  description: string;
  status: BackgroundTaskStatus;
  result?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

const tasks = new Map<string, BackgroundTask>();

// Listeners waiting on a specific task to settle (completed or error) — the
// event-driven half of scheduleWakeup's waitingOnTaskId pairing. Each task id
// gets at most one active subscriber in practice (one pending wakeup per
// session), but this supports a Set defensively rather than assuming that.
const settleListeners = new Map<string, Set<(task: BackgroundTask) => void>>();

/**
 * Register a new background task. Pass an explicit `id` for tasks that
 * already have a natural unique id (e.g. a shell command's PID, stringified);
 * omitted, one is generated (used by spawnAgent, which has no natural id).
 */
export function createBackgroundTask(
  name: string,
  description: string,
  id: string = crypto.randomUUID().slice(0, 12),
): string {
  tasks.set(id, { id, name, description, status: "running", startedAt: Date.now() });
  
  return id;
}

function notifySettled(id: string, task: BackgroundTask) {
  const listeners = settleListeners.get(id);
  if (!listeners) return;
  settleListeners.delete(id);
  for (const listener of listeners) listener(task);
}

export function completeBackgroundTask(id: string, result: string): void {
  const task = tasks.get(id);
  if (!task) return;
  task.status = "completed";
  task.result = result;
  task.finishedAt = Date.now();
  notifySettled(id, task);
}

export function failBackgroundTask(id: string, error: string): void {
  const task = tasks.get(id);
  if (!task) return;
  task.status = "error";
  task.error = error;
  task.finishedAt = Date.now();
  notifySettled(id, task);
}

export function getBackgroundTask(id: string): BackgroundTask | undefined {
  return tasks.get(id);
}

/**
 * Subscribe to a task settling (completed or error). If it has already
 * settled, the listener fires on the next microtask instead of synchronously,
 * so callers can always treat this as "fires later" regardless of timing.
 * Returns an unsubscribe function — always call it once the listener is no
 * longer relevant (e.g. a competing timer fired first) to avoid a stray
 * double-fire later.
 */
export function onTaskSettled(
  taskId: string,
  listener: (task: BackgroundTask) => void,
): () => void {
  const existing = tasks.get(taskId);
  if (existing && existing.status !== "running") {
    queueMicrotask(() => listener(existing));
    return () => {};
  }

  let listeners = settleListeners.get(taskId);
  if (!listeners) {
    listeners = new Set();
    settleListeners.set(taskId, listeners);
  }
  listeners.add(listener);

  return () => {
    settleListeners.get(taskId)?.delete(listener);
  };
}

// Pure decision logic for the user-turn pipeline: whether a submission may
// start a turn right now or must be parked on the queue, whether an auto-drain
// may fire, how many held messages to surface, and the settle-waiter gate used
// by abortAndSettle. Kept free of React/SDK types so it's unit-testable — see
// src/tests/chat-turn-gate.test.ts. The rules encoded here:
//
// - A turn sent mid-compaction races the server-side snapshot/transaction and
//   can be summarized away or land past a stale instruction boundary, so while
//   the compaction hold is up, submissions park on the hidden background-task
//   origin instead of starting a turn.
// - An ordinary busy stream queues submissions visibly (pre-existing behavior).
// - Queue drains require an idle agent AND no active hold; releasing the hold
//   never fires them implicitly because chat.status didn't change — the caller
//   drains explicitly after compact settles.

/** Mirrors the AI SDK's chat.status union (kept local to avoid SDK coupling). */
export type TurnStatus = "submitted" | "streaming" | "ready" | "error";

export type SubmitGateDecision =
  | { action: "send" }
  | { action: "queue"; origin?: "background-task" };

/**
 * What should happen to a user submission arriving right now?
 * - Agent busy (turn in flight): queue visibly — user sees it, can skip/remove.
 * - Compaction hold (and idle): queue hidden under the background-task origin —
 *   invisible in the panel, not skippable/removable, drained post-compact.
 * - Otherwise: start the turn immediately.
 */
export function classifyUserSubmit(
  status: TurnStatus,
  compactionHold: boolean,
): SubmitGateDecision {
  const busy = status === "submitted" || status === "streaming";
  if (busy) return { action: "queue" };
  if (compactionHold) return { action: "queue", origin: "background-task" };
  return { action: "send" };
}

/**
 * May a queued message head out as a new turn this instant? Requires the agent
 * idle and no compaction hold. Shared by the auto-drain effect, the explicit
 * post-compact drain, and background-task pushes.
 */
export function canSendTurn(
  status: TurnStatus,
  compactionHold: boolean,
): boolean {
  return status === "ready" && !compactionHold;
}

/**
 * How many messages sit on the hidden side of the queue right now? Only
 * meaningful while the compaction hold is up: outside it, background-task
 * entries legitimately ride the hidden side during ordinary streaming and
 * aren't "held", so report zero rather than mislabeling them.
 */
export function computeHeldQueueCount(
  compactionActive: boolean,
  totalQueued: number,
  visibleQueued: number,
): number {
  if (!compactionActive) return 0;
  return Math.max(0, totalQueued - visibleQueued);
}

/**
 * Resolve-lever registry for "wake me when the aborted turn settles": callers
 * park promises via wait(), the status-mirror effect fires signal() on every
 * transition to "ready". Signaling clears the set — a waiter parked after a
 * signal stays pending until the NEXT transition, matching the fact that each
 * waiter is waiting for its own abort to settle, not for history.
 */
export class SettleGate {
  private waiters = new Set<() => void>();

  wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.add(resolve);
    });
  }

  signal(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiters) resolve();
  }

  get pendingCount(): number {
    return this.waiters.size;
  }
}

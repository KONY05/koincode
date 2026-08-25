import { describe, expect, test } from "bun:test";

import {
  canSendTurn,
  classifyUserSubmit,
  computeHeldQueueCount,
  SettleGate,
} from "../lib/chat-turn-gate";

describe("classifyUserSubmit — what happens to a submission right now", () => {
  test("idle agent, no hold → start the turn immediately", () => {
    expect(classifyUserSubmit("ready", false)).toEqual({ action: "send" });
    // An errored stream is not busy — the next submit retries outright.
    expect(classifyUserSubmit("error", false)).toEqual({ action: "send" });
  });

  test("busy stream → visible queue entry (pre-existing skip/remove UX)", () => {
    expect(classifyUserSubmit("submitted", false)).toEqual({
      action: "queue",
      origin: undefined,
    });
    expect(classifyUserSubmit("streaming", false)).toEqual({
      action: "queue",
      origin: undefined,
    });
  });

  test("compaction hold while idle → hidden background-task queue entry", () => {
    // This is the race fix: a turn started mid-compact can be summarized away
    // or land past a stale instruction boundary, so it must park instead.
    const decision = classifyUserSubmit("ready", true);
    expect(decision.action).toBe("queue");
    if (decision.action === "queue") {
      expect(decision.origin).toBe("background-task");
    }
  });

  test("compaction hold during an in-flight turn → still visible queue", () => {
    // Manual /compact aborts the stream first; during that window the ordinary
    // visible-queue path applies (the hold only hides *new* idle submissions).
    const decision = classifyUserSubmit("streaming", true);
    expect(decision.action).toBe("queue");
    if (decision.action === "queue") {
      expect(decision.origin).toBeUndefined();
    }
  });
});

describe("canSendTurn — may a queued message head out this instant", () => {
  test("requires idle AND no compaction hold", () => {
    expect(canSendTurn("ready", false)).toBe(true);
    expect(canSendTurn("ready", true)).toBe(false);
    expect(canSendTurn("submitted", false)).toBe(false);
    expect(canSendTurn("streaming", false)).toBe(false);
    expect(canSendTurn("error", false)).toBe(false);
  });

  test("releasing the hold does not make a busy agent sendable", () => {
    // The post-compact drain calls this fresh; a background push that arrived
    // mid-hold must still wait for the stream it shares the agent with.
    expect(canSendTurn("submitted", false)).toBe(false);
  });
});

describe("computeHeldQueueCount — hidden side of the queue", () => {
  test("zero outside compaction even when hidden entries exist", () => {
    // Background-task results legitimately ride the hidden queue during
    // ordinary streaming — they must not read as "held".
    expect(computeHeldQueueCount(false, 5, 3)).toBe(0);
    expect(computeHeldQueueCount(false, 2, 0)).toBe(0);
  });

  test("active compaction reports total minus visible", () => {
    expect(computeHeldQueueCount(true, 3, 1)).toBe(2);
    expect(computeHeldQueueCount(true, 1, 0)).toBe(1);
    expect(computeHeldQueueCount(true, 4, 4)).toBe(0);
  });

  test("never negative", () => {
    expect(computeHeldQueueCount(true, 1, 3)).toBe(0);
  });
});

describe("SettleGate — abortAndSettle's wake-up mechanism", () => {
  test("signal resolves parked waiters", async () => {
    const gate = new SettleGate();
    const settled = gate.wait();
    let resolved = false;
    void settled.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    gate.signal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(true);
  });

  test("one signal wakes every waiter", async () => {
    const gate = new SettleGate();
    const first = gate.wait();
    const second = gate.wait();
    expect(gate.pendingCount).toBe(2);

    gate.signal();

    await Promise.all([first, second]);
    expect(gate.pendingCount).toBe(0);
  });

  test("a waiter parked after a signal stays pending until the NEXT one", async () => {
    // Matches the effect contract: each wait() is for its own transition, not
    // for history — otherwise a stale ready-state would instantly release an
    // abort that hasn't happened yet.
    const gate = new SettleGate();
    gate.signal();

    let resolved = false;
    void gate.wait().then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    gate.signal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(true);
  });

  test("abort-settle shape: race resolves as soon as the gate fires", async () => {
    // Mirrors abortAndSettle: race(gate.wait(), timeout) must come back via
    // the gate well inside the timeout budget once status lands on ready.
    const gate = new SettleGate();
    const settled = gate.wait();
    setTimeout(() => gate.signal(), 5);
    const start = Date.now();
    await Promise.race([
      settled,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("abort-settle shape: timeout wins when the gate never fires", async () => {
    const gate = new SettleGate();
    const start = Date.now();
    await Promise.race([
      gate.wait(),
      new Promise((resolve) => setTimeout(resolve, 30)),
    ]);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(gate.pendingCount).toBe(1); // abandoned, but harmless
  });
});

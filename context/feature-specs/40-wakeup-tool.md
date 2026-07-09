i was thinking of if we should implement a wake-up tool, since the app can run even while the machine is closed, but i don't really know any scenarios where this is useful, i think it could be but do you have a scenarios where this might be useful if we implement it?

## Scenarios considered

- Long-running builds/tests/installs the agent doesn't need to babysit interactively.
- Waiting on external CI/deploy status, checking back periodically instead of blocking.
- True cron-style automation: "check for new PRs every morning," "run tests nightly," while the CLI/terminal is closed.

## Correction — scope narrowed after seeing the actual inspiration

An initial pass at this spec went with the third scenario and designed a full admin-configured recurring scheduler: a `ScheduledTask` Prisma model with cron-like cadence, OS-level registration (launchd/cron/`schtasks`), a one-shot headless `koincode run-schedule <id>` runner, and a permission-ledger gating scheme for unattended tool calls (since nobody's at the terminal to answer an approval widget).

That was the wrong shape. What actually inspired the feature turned out to be a `ScheduleWakeup`-style tool used *inside an already-running task* — an agent waiting on something it started in the background (a subagent, a long build) calls it to defer its own next check-in by N seconds instead of busy-polling, then keeps rescheduling itself until there's nothing left to check. Not an admin-configured recurring job at all — a self-directed pacing mechanism for one live task.

This collapses almost all the complexity from the first draft: since the continuation always resumes a session that's already interactively open, the existing approval widget, permission system, and tool execution pipeline apply completely unchanged. There's no "unattended" execution to gate, because the CLI is still the one live process driving everything — a scheduled wakeup just triggers the next turn the same way pressing Enter would. No `ScheduledTask` table, no OS scheduler integration, no headless executor, no permission-ledger bypass question.

## Decision

Add a `scheduleWakeup` tool the agent can call mid-task to defer its own next check-in by a delay, with a reason — mirroring the pattern in the screenshot (`ScheduleWakeup({ delaySeconds, reason })` → `"Next wakeup scheduled for HH:MM:SS (in Ns). Nothing more to do."`).

Mechanism: an in-memory timer scoped to the live `useChat` hook instance for that session — not a server-side job, not a DB row, not an OS-registered scheduled task. When it fires, if that session is still open in the running CLI, a synthesized continuation message is auto-submitted into the same session, exactly as if the user had pressed Enter, and the normal turn/tool-execution/approval-widget pipeline takes over from there with zero special-casing.

**Known, accepted limitation**: this only survives while the CLI process itself stays alive — backgrounded, minimized, or the laptop lid closed without the machine actually sleeping. It does **not** survive fully quitting the CLI or the machine powering off; no server persistence or OS-level scheduler is built for that case in this pass. Same posture the project has already taken elsewhere (e.g. the VS Code notification fallback's "can't reach a genuinely different app" limitation, or Windows being scoped out of the voice recorder) — ship the mechanism that covers the real scenario, call out the ceiling explicitly rather than half-building a heavier version to chase it.

## Design

### 1. Tool contract (`packages/shared/src/schemas.ts`)

```ts
scheduleWakeup: {
  delaySeconds: number; // clamp to a sane range, e.g. 10–3600
  reason: string;       // human-readable, shown in the transcript's tool-view
  prompt: string;       // the actual continuation instruction fed back to the model on fire
}
```

`reason` and `prompt` are deliberately separate fields, not one — `reason` is the short "why" shown to the user in the tool-view (matching the screenshot's `IN`/`OUT` framing), while `prompt` is the specific instruction the model writes for its *future* self: what to check, which task/file/id to reference, and what to do once it has that information. Firing replays `prompt` verbatim as the continuation message (§3), not a generic "wakeup, check on things."

Available in BUILD mode (where an agent is realistically waiting on something it started itself, e.g. a background `shell` call). Not needed in PLAN mode, which has no way to start background work to wait on.

**Dependency, tracked separately**: the inspiration screenshot's specific scenario — waiting on a background *sub-agent* — isn't fully reachable in KOINCODE yet. `runSpawnAgent` (`packages/cli/src/tools/spawn-agent.ts`) is synchronous today: it `await`s the sub-agent's entire step loop inline and blocks the parent turn until it returns, with no detached/background mode and no status-polling mechanism. `scheduleWakeup` doesn't depend on this — it's just as useful for "check back on a background `shell` call" (which already supports `run_in_background`, per the browser-control feature) — but the exact "check on my research agent" case needs spawnAgent to grow its own non-blocking mode first, mirroring the `shell` tool's existing `run_in_background` flag. **Confirmed as planned follow-up work** — see the "Background/async execution mode" addendum in `context/feature-specs/13-subagent-tool-implementation.md`. Not in scope for this spec; that one implements it.

### 2. CLI-local execution (`packages/cli/src/tools/schedule-wakeup.ts`)

Handled like any other local tool via `executeLocalTool` (`packages/cli/src/tools/index.ts`) — no server involvement, no filesystem access. It:

1. Computes `scheduledFor = Date.now() + delaySeconds * 1000`.
2. Registers a `setTimeout` against that session's live chat state (module-level map keyed by session id in `hooks/use-chat.ts`, so a session's timer survives navigating away from that screen as long as the CLI process itself is still running, and is looked up/cleared correctly if the user returns to it). **One pending wakeup per session, not several** — the map is keyed by `sessionId`, so a second `scheduleWakeup` call silently cancels and replaces the first rather than stacking. Deliberate: a session has one "next resumption point" at a time, matching the screenshot's model (the agent picks *a* check-in time, not independent timers per background thing) — if it started multiple background things, it re-checks everything relevant whenever it does wake up, rather than juggling several queued continuation prompts landing back-to-back.
3. Returns immediately: `{ scheduledFor, delaySeconds, reason }` — rendered in the transcript the same way the screenshot shows it ("Next wakeup scheduled for HH:MM:SS (in Ns)."). `prompt` is stored alongside the timer (not part of the visible result) for §3 to use when it fires.

### 3. Firing behavior (`packages/cli/src/hooks/use-chat.ts`)

On timer fire: if the session is still the active one, auto-submit the stored `prompt` verbatim through the exact same send path a real user message takes — no bypass of tool execution, approvals, or persistence, and no generic placeholder text substituted in its place. The model wrote that prompt for exactly this moment (which task/file/id to check, what to do with the result), so replaying it as-is is what makes the continuation actually specific instead of a vague "check on progress." The model may call `scheduleWakeup` again (chaining checks until it decides there's nothing left to do, matching the screenshot's "Nothing more to do") or finish the turn normally.

**Cancellation**: if the user sends a real message before the timer fires, clear the pending timeout for that session first — a stale wakeup firing in the middle of unrelated new activity would be confusing and is never useful.

### 4. Rendering

New tool-view component alongside the existing per-tool ones in `components/messages/bot-message.tsx` (same pattern as `EditFileDiff`/`WriteFilePreview`): shows the reason and the resolved wake time/countdown, matching the screenshot's `IN`/`OUT` framing.

## Package boundaries

CLI + shared only — no server or database changes. Smaller than the two-package default `ai-workflow-rules.md` asks for, not more.

## Suggested implementation order

1. `scheduleWakeup` tool contract in `@koincode/shared/schemas.ts` (BUILD mode tool set).
2. CLI executor + confirmation result shape. Verifiable alone: calling it returns the right `scheduledFor`/message, no side effects beyond registering the timer.
3. Wire firing → auto-submit continuation message in `use-chat.ts`, plus cancel-on-new-user-message. Verifiable alone: schedule a short (10s) wakeup, do nothing, confirm the session auto-continues; schedule one, then type a message before it fires, confirm the stale wakeup never fires.
4. Tool-view rendering.

## Open questions / deferred

- Exact clamp range for `delaySeconds` (screenshot used 90s; needs an upper bound so it can't be used to silently "schedule" something an hour out that nobody will be present for).
- Whether to warn/no-op if the CLI's containing terminal session ends up fully closed before a pending wakeup fires (currently: it just silently never fires — acceptable for v1, but worth a status-bar indicator so the user knows a wakeup is pending and shouldn't fully quit yet).
- Surviving a full CLI restart mid-wait (e.g. an in-app `/update`) — currently out of scope; the timer is lost like any other in-memory state.

## Status

Implemented per this spec. `scheduleWakeup` added to `toolInputSchemas` and `buildToolContracts` (`packages/shared/src/schemas.ts`, BUILD mode only). CLI dispatch in `packages/cli/src/hooks/use-chat.ts`: a module-level `_pendingWakeups` map (sessionId → `{ timeoutId, unsubscribe? }`) alongside the existing `_activeModes` map, cleared on session unmount and at the top of `submit()` (real user message cancels a pending wakeup). Firing always routes through `setMessageQueue` rather than calling `chat.sendMessage`/reading `chat.status` directly from the timeout closure — that closure is captured at schedule time and can be many renders stale by fire time (up to 30 minutes later); `setMessageQueue` is a plain state setter, safe to call regardless of closure age, and the pre-existing auto-drain effect already reads `chat.status` reactively and sends once actually idle. Inline rendering added to `bot-message.tsx` (`Wakeup scheduled: <reason> — next check-in at HH:MM:SS (in Ns)`). System prompt (`packages/server/src/prompts/system-prompt.ts`) gained a BUILD-only rule pairing this with `run_in_background`/`spawnAgent runInBackground` so the model actually reaches for it instead of polling.

**Follow-up: event-driven pairing with background sub-agent completion.** Comparing against the reference trace that inspired this feature showed a gap — in that trace, a background task's own completion pushes a notification back to the parent directly, as a *second* trigger independent of the timer. Added `waitingOnTaskId` (optional) to `scheduleWakeup`'s schema: when set, `packages/cli/src/lib/agent-background-tasks.ts` gained `onAgentTaskSettled(taskId, listener)` (fires once, on the next microtask if the task already settled, otherwise on `completeAgentBackgroundTask`/`failAgentBackgroundTask`) — `use-chat.ts` subscribes when a `waitingOnTaskId` is given, and whichever trigger wins first (the `setTimeout` or the task settling) tears down the other, so a wakeup only ever fires once: the timer firing calls the stored `unsubscribe()` before queuing; the task-settle listener calls `clearTimeout` before queuing (with the task's result appended to the fired prompt: `"${prompt}\n\n---\nTask ${id} completed. Result:\n${result}"`, or the error equivalent). Neither trigger cancels the underlying task itself — only which trigger is still "live" for that particular wakeup. `bot-message.tsx`'s view shows `, or sooner if task <shortId> finishes first` when present. System prompt rule 7 updated to tell the model to pass `waitingOnTaskId` when the wakeup is specifically about a `runInBackground` sub-agent.

**Follow-up: renamed `background-tasks.ts` → `agent-background-tasks.ts`** (`BackgroundTask` → `AgentBackgroundTask`, and all its functions) to disambiguate from `session-background-work.ts`'s generic cancellation registry, which covers both this and `shell run_in_background` — see `13-subagent-tool-implementation.md`'s cancellation follow-up.

**Bug found via live manual testing, now fixed: the wakeup message never actually got sent.** Manually tested the exact "start a backgrounded shell command, schedule a 30s wakeup" scenario in a real terminal — the wakeup fired, the item visibly appeared in the message queue UI, but it just sat there indefinitely. Pressing Enter (with a new message) didn't drain it either.

Root cause: the auto-drain effect (in `use-chat.ts`, pre-existing, not part of this feature) only re-runs on `chat.status` *transitions* — its dependency array is `[chat.status]`. It was written for the original queueing case: a message queued while a turn is `streaming`/`submitted`, drained the moment status flips to `ready`. But by the time a `scheduleWakeup` timer fires, the turn that scheduled it has long since finished — `chat.status` has been sitting at `"ready"` continuously, with no transition for the effect to catch. Pushing onto `messageQueue` doesn't itself change `chat.status`, so the effect never re-fires, and the message is stuck forever. This is the opposite failure mode from the one `queueMessage` was originally built to avoid (§3's "stale closure" reasoning was correct for *why not* to read `chat.status`/call `chat.sendMessage` directly from an old closure — but routing everything through the queue as the fix introduced this new, worse bug where delivery could just silently never happen).

Fixed by adding a `chatStatusRef` (mirrors `chat.status` every render, same pattern as the pre-existing `messageQueueRef`) and having `queueMessage` check it live at firing time: if a turn is genuinely in progress (`submitted`/`streaming`), queue as before (that case *does* end in a real transition, so the existing drain effect still handles it correctly); otherwise — the common case, since usually the parent has gone idle by the time a background wakeup fires — call `chat.sendMessage(...)` directly, immediately. This is safe against the original staleness concern because `chat.sendMessage` is a stable *method* (safe to call from an old closure, same as the existing `chat.addToolOutput` calls elsewhere in this file already do), whereas `chat.status` is a plain *value* snapshotted per-render (unsafe to read from an old closure) — the fix reads the live value via `chatStatusRef.current` instead of the stale closure, then calls the always-safe method.

**Not verified live** — no real TTY session in this environment to exercise an actual schedule → wait → auto-continue round trip, or the task-settle-wins-first race; verified via `bun run typecheck` (clean across all four packages) and code review. The delivery bug above **was** caught via the user's own live manual test — the fix for it has not yet been re-verified live in turn.

**Follow-up: `waitingOnTaskId` now also pairs with backgrounded shell commands, and delivery renders on the assistant side (see `41-background-task-result-delivery.md`).** The background-task registry (`agent-background-tasks.ts` → `background-tasks.ts`) was generalized so `run_in_background` shell commands register into the same registry as `runInBackground` sub-agents, keyed by the stringified PID — `scheduleWakeup`'s `waitingOnTaskId` handling in `use-chat.ts` needed no changes at all to support this, since it already only depended on the generic `onTaskSettled(taskId, listener)` shape, never on what kind of work `taskId` referred to. Separately, every message `queueMessage` delivers on behalf of `scheduleWakeup` (both the plain timer fire and the task-linked fire, both routed through the shared `fire()` helper) is now tagged with `metadata.origin = "background-task"`, so the transcript renders it through `BotMessage` instead of as a `UserMessage` bubble — it still reaches the model as a real `role: "user"` turn on the wire, only the local render choice changed.

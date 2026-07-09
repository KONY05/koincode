since we've gotten most of the tool calling out of the way, i want us to focus on subagents functionality now. this will be when the main agent has a lot of work to do that it needs to break down or when it feels like splitting up and delegating to other agents to work in the background is the best approach.

and when rendering the tool in the UI, we can style it just like other tools (the readFile etc, that shows "Read file path"), but instead of a file path, it should show the name of the subagent, and the user can click on to open the subagent UI. and the subagent UI should be able to show the output of the subagents in the UI (not yet sure if i want to show it). but the response of the subagent won't be shown in the main chat UI but it will be sent back to the main llm so it can work with what it's done

## Comparison reference
class SubagentParams(BaseModel):
    goal: str = Field(
        ..., description="The specific task or goal for the subagent to accomplish"
    )


@dataclass
class SubagentDefinition:
    name: str
    description: str
    goal_prompt: str
    allowed_tools: list[str] | None = None
    max_turns: int = 20
    timeout_seconds: float = 600


class SubagentTool(Tool):
    def __init__(self, config: Config, definition: SubagentDefinition):
        super().__init__(config)
        self.definition = definition

    @property
    def name(self) -> str:
        return f"subagent_{self.definition.name}"

    @property
    def description(self) -> str:
        return f"subagent_{self.definition.description}"

    schema = SubagentParams

    def is_mutating(self, params: dict[str, Any]) -> bool:
        return True

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        from agent.agent import Agent
        from agent.events import AgentEventType

        params = SubagentParams(**invocation.params)
        if not params.goal:
            return ToolResult.error_result("No goal specified for sub-agent")

        config_dict = self.config.to_dict()
        config_dict["max_turns"] = self.definition.max_turns
        if self.definition.allowed_tools:
            config_dict["allowed_tools"] = self.definition.allowed_tools

        subagent_config = Config(**config_dict)

        prompt = f"""You are a specialized sub-agent with a specific task to complete.

        {self.definition.goal_prompt}

        YOUR TASK:
        {params.goal}

        IMPORTANT:
        - Focus only on completing the specified task
        - Do not engage in unrelated actions
        - Once you have completed the task or have the answer, provide your final response
        - Be concise and direct in your output
        """

        tool_calls = []
        final_response = None
        error = None
        terminate_response = "goal"

        try:
            async with Agent(subagent_config) as agent:
                deadline = (
                    asyncio.get_event_loop().time() + self.definition.timeout_seconds
                )

                async for event in agent.run(prompt):
                    if asyncio.get_event_loop().time() > deadline:
                        terminate_response = "timeout"
                        final_response = "Sub-agent timed out"
                        break

                    if event.type == AgentEventType.TOOL_CALL_START:
                        tool_calls.append(event.data.get("name"))
                    elif event.type == AgentEventType.TEXT_COMPLETE:
                        final_response = event.data.get("content")
                    elif event.type == AgentEventType.AGENT_END:
                        if final_response is None:
                            final_response = event.data.get("response")
                    elif event.type == AgentEventType.AGENT_ERROR:
                        terminate_response = "error"
                        error = event.data.get("error", "Unknown")
                        final_response = f"Sub-agent error: {error}"
                        break
        except Exception as e:
            terminate_response = "error"
            error = str(e)
            final_response = f"Sub-agent failed: {e}"

        result = f"""Sub-agent '{self.definition.name}' completed. 
        Termination: {terminate_response}
        Tools called: {', '.join(tool_calls) if tool_calls else 'None'}

        Result:
        {final_response or 'No response'}
        """

        if error:
            return ToolResult.error_result(result)

        return ToolResult.success_result(result)

## Follow-up: background/async execution mode

`runSpawnAgent` (`packages/cli/src/tools/spawn-agent.ts`) shipped synchronous only — the parent turn `await`s the whole sub-agent step loop inline and blocks until it returns. The original framing above ("delegating to other agents to work in the background") implied non-blocking execution, but that part was never actually built.

**To implement**: a `runInBackground` flag on `spawnAgent`'s input, mirroring the `shell` tool's existing `run_in_background` pattern (`packages/cli/src/tools/shell.ts`) — when set, the tool call returns immediately with a task id instead of awaiting completion, the sub-agent keeps running detached, and the model needs a way to check back on it later (status/result), since unlike a backgrounded shell PID there's no OS process to independently poll — this needs its own in-memory task registry plus a check-status tool. Surfaced from the `40-wakeup-tool.md` design as the missing piece behind "waiting on a background research agent" — that scenario needs this before it's actually reachable.

## Status

Implemented. `runInBackground` added to `spawnAgent`'s input schema (`packages/shared/src/schemas.ts`). New `checkAgentTask` tool (schema + `readOnlyToolContracts` entry, same set as `spawnAgent`) reads from a new in-memory registry, `packages/cli/src/lib/agent-background-tasks.ts` (`createAgentBackgroundTask`/`completeAgentBackgroundTask`/`failAgentBackgroundTask`/`getAgentBackgroundTask`, keyed by a short `crypto.randomUUID()` id) — process-lifetime only, same accepted limitation as `scheduleWakeup`'s timer, no disk persistence in this pass. Named with an `Agent` prefix specifically to distinguish it from `session-background-work.ts`'s more generic "background work" cancellation registry (which also covers `shell run_in_background`, not just sub-agents) — see the cancellation follow-up below. `packages/cli/src/tools/check-agent-task.ts` is the pure/synchronous executor, dispatched normally through `executeLocalTool`'s switch (`packages/cli/src/tools/index.ts`) since it has no live-hook dependency, unlike `spawnAgent` itself.

In `use-chat.ts`'s `onToolCall`, the `spawnAgent` branch now checks `runInBackground` first: if set, it registers the task, kicks off the existing `runSpawnAgent(...)` call without `await`ing it (`.then`/`.catch` update the registry on completion/error), and returns `{ taskId, status: "running", message }` immediately — the pre-existing synchronous path (`setIsSubagentRunning`, blocking `await`) is unchanged for the non-background case. `bot-message.tsx`'s `spawnAgent` view shows `— running in background (task <id>)` when the output carries a `taskId`.

System prompt (`packages/server/src/prompts/system-prompt.ts`) BUILD-mode rules gained a rule pairing this with `scheduleWakeup` so the model knows to check back via a scheduled wakeup rather than polling immediately in the same turn.

**Follow-up**: `checkAgentTask` initially had no custom tool-view and fell to the generic fallback renderer, which only formats the tool *input* (just the raw taskId) — a user would see the check happen with zero indication of whether it found the task still running, completed, or errored. Decided to surface it in the transcript rather than hide it (matching the inspiration screenshot, where status-check calls appear as small dimmed lines, not hidden — and since `scheduleWakeup` already spaces checks out by design, this won't spam the transcript the way tight-loop polling would). Added a custom view in `bot-message.tsx` showing `Checked task <shortId>: still running` / `: completed` / `: error — <msg>`.

**Follow-up: event-driven completion notification.** Checking the reference trace that inspired `scheduleWakeup` showed background task completion should be able to resume the parent session on its own, not only via a pre-scheduled timer. `agent-background-tasks.ts` gained `onAgentTaskSettled(taskId, listener)` — a one-shot subscription that fires when `completeAgentBackgroundTask`/`failAgentBackgroundTask` runs (or on the next microtask, if the task already settled before the subscriber attached, to close the race where a task finishes right as the subscription is being registered). This is consumed from `scheduleWakeup`'s `waitingOnTaskId` param (see `40-wakeup-tool.md`'s Status) rather than `checkAgentTask` itself — `checkAgentTask` stays a plain synchronous poll with no subscription behavior of its own.

**Follow-up: cancel background work on session unmount.** Previously, nothing ever cancelled a `runInBackground` sub-agent — it kept consuming API calls/tokens for a task nobody could see the result of anymore once the user navigated away or redirected the conversation. New `packages/cli/src/lib/session-background-work.ts` (`registerBackgroundWork(sessionId, cancelFn)` / `cancelAllBackgroundWork(sessionId)`) tracks cancel callbacks per session for both kinds of backgrounded work:
- **`spawnAgent runInBackground`**: `runSpawnAgent` (`packages/cli/src/tools/spawn-agent.ts`) gained an optional `signal?: AbortSignal` — checked at the top of each step loop iteration (throws `"Sub-agent cancelled"` if aborted) and passed into the `fetchWithRestart` call's `init` so an in-flight step request aborts immediately too. `use-chat.ts`'s background branch creates an `AbortController` per spawn, registers `() => controller.abort()`, and deregisters in a `.finally()` alongside the existing `completeAgentBackgroundTask`/`failAgentBackgroundTask` settle handling.
- **`shell run_in_background`**: `runShellCommand` (`packages/cli/src/tools/shell.ts`) now takes an optional `sessionId`, registers `() => proc.kill()` for backgrounded processes, and deregisters via `proc.exited.then(deregister)` so the registry doesn't accumulate entries for long-finished processes. `sessionId` is threaded through from `executeLocalTool`'s existing `sessionId` param (`tools/index.ts`), same pattern already used for the browser tools.
- The session-unmount cleanup effect in `use-chat.ts` (same one that already clears `_activeModes`/`clearPendingWakeup`) now also calls `cancelAllBackgroundWork(sessionId)`.

**Follow-up: default delivery — `scheduleWakeup` is optional, not required.** Previously, a `runInBackground` sub-agent's result only ever reached the parent if the model explicitly paired it with a `scheduleWakeup({ waitingOnTaskId })`. If it didn't — and it's under no obligation to, `scheduleWakeup` was only ever meant as a "nice to have for when the parent expects to be idle," not a mandatory pairing — the result just sat in the registry, seen by no one, unless the model happened to remember to check back on some later, unrelated turn. Worse, if the session unmounted before the task finished, the new cancel-on-unmount behavior above would actively abort it.

Fixed by making delivery unconditional: the moment a `runInBackground` task is created, `use-chat.ts` immediately subscribes via `onAgentTaskSettled(taskId, listener)` with a default listener that pushes the result (or error) straight onto the message queue — the same `queueMessage` helper `scheduleWakeup` uses (extracted as a shared function, since both need the same "always go through `setMessageQueue`, never call `chat.sendMessage` directly from a callback that may fire far later" reasoning). This default listener is tracked in a new module-level `_defaultTaskListeners` map (taskId → unsubscribe).

If the model *does* also call `scheduleWakeup({ waitingOnTaskId })` for that same task (to get a specific follow-up prompt, or to also race against a timer), the `scheduleWakeup` handler cancels the default listener first (`_defaultTaskListeners.get(waitingOnTaskId)?.()`) before registering its own — so the task only ever delivers once, via whichever mechanism the model actually asked for, never both. Tool descriptions (`schemas.ts`) and the system prompt rule (`system-prompt.ts`) were reworded to stop implying `scheduleWakeup` is required for background work to reach the parent at all — it's now framed as optional, for when the model wants a specific timed or prompted check-in.

**Follow-up: more precise final-output instructions + honest partial-progress fallbacks.** The prior instruction to sub-agents was just "be concise and direct" — replaced with a concrete shape (`packages/cli/src/tools/spawn-agent.ts`'s `finalOutputInstructions`, shared by both prompt-wrapping branches): a one-sentence outcome, key findings/changes as actionable bullet points, then anything blocking or uncertain — while explicitly allowing it to skip inapplicable sections rather than padding with empty headers.

Also fixed: the timeout and max-steps fallback paths previously discarded all of a sub-agent's actual work in favor of a placeholder string (`"(Sub-agent timed out)"`) or, for max-steps, whatever text happened to be attached to the very *last* assistant turn — which by definition still had pending tool calls, so was often a fragment like "let me check X next," not anything useful. New `collectPartialProgress(messages)` gathers every text part across *all* assistant turns instead; both fallback paths now return that accumulated progress (clearly prefixed as incomplete, e.g. `"(Sub-agent timed out before finishing — here's its progress so far:)"`), falling back to a placeholder only if there's truly no text to show.

**Follow-up: exposed `maxTurns`/`timeoutSeconds` on the tool schema — the timeout path was previously unreachable.** Both existed on the internal `SpawnAgentInput` TypeScript type (only ever set by the commented-out `CODE_REVIEWER` built-in), but `spawnAgent`'s actual Zod schema never included them, and `use-chat.ts`'s dispatch never passed them through — meaning every live sub-agent always ran with `deadline = null` (no timeout, ever) and the hardcoded `maxSteps = 50`. Added both to `toolInputSchemas.spawnAgent` (`packages/shared/src/schemas.ts`): `maxTurns` (`1–50`, default `20`) and `timeoutSeconds` (`30–1800`, default `300`) — both `.optional().default(...)`, so a model that omits them still gets a bounded run rather than `timeoutSeconds` parsing to `undefined` and `deadline` staying `null` forever. `use-chat.ts`'s two `runSpawnAgent(...)` call sites (foreground and background) now destructure and pass both through. Tool contract description updated to tell the model to lower them for a quick lookup or raise them for genuinely long research, framing the timeout/max-steps fallback as "returns partial progress" rather than "fails."

**Follow-up, found via a live max-steps test (`maxTurns: 2` on an open-ended research task): partial progress showed nothing.** The `collectPartialProgress` fallback (added above) only ever collected `type: "text"` parts — with a 2-turn cap, the sub-agent had just enough room to make tool calls but no room left to narrate or conclude, so both turns' assistant content was pure `tool-call` entries with no accompanying text. Text-only collection correctly found nothing and fell back to the bare placeholder (`"(Sub-agent reached maximum steps without producing any output.)"`) — technically correct per the code, but defeating the actual point of the fix (showing that real work happened). Added `summarizeToolCall(part)` (`spawn-agent.ts`) — a compact one-liner like `readFile(src/index.ts)`, built the same way `bot-message.tsx`'s generic tool-view fallback formats args (`Object.values(input).join(" ")`) — and `collectPartialProgress` now includes a `→ toolName(args)` line for every `tool-call` part alongside existing `text` parts, not just text. A 2-turn run that made two tool calls with zero narration now shows what it was doing (`→ grep(...)`, `→ readFile(...)`) instead of a bare "no output" message.

**Not verified live** — no real TTY session in this environment to exercise an actual background spawn → checkAgentTask/wakeup round trip, the unmount-cancels-background-work path, or the default-delivery path; verified via `bun run typecheck` (clean across all four packages). The timeout/max-steps partial-progress path (including the tool-call-summary fix above) **was** exercised live by the user, which is what surfaced this gap.

**Follow-up: registry generalized to cover shell background tasks too (see `41-background-task-result-delivery.md`).** `agent-background-tasks.ts` was renamed back to `background-tasks.ts` and its API genericized (`AgentBackgroundTask` → `BackgroundTask`, `createAgentBackgroundTask`/`completeAgentBackgroundTask`/`failAgentBackgroundTask`/`getAgentBackgroundTask`/`onAgentTaskSettled` → `createBackgroundTask`/`completeBackgroundTask`/`failBackgroundTask`/`getBackgroundTask`/`onTaskSettled`) — the `Agent`-prefixed naming's original justification ("used for only agent background task," see the Implemented paragraph above) stopped holding once `shell run_in_background` started registering into the same registry. All references throughout this file to the old names describe the state at the time they were written; the current API lives in `background-tasks.ts`.

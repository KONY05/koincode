i've been using claude code for a while and i noticed one thing that's changed about it.
any time i ask it about a task or to perform a task in a fresh session or even after we've discussed it researches the codebase, but this time its not the main agent doing the code exploration, it always fires a subagent to do the code exploration meaning its not bloating its context with the findings, then the model reports back and the main agent uses that code exploration result to start with the issue, and I noticed in KOINCODE the agents don't take that approach at all and it seems that approach is very optimal

and that the main agent sometimes never does the heavy lifting research work, its always delegated

examples included as well

## Discussion

Two reference examples surfaced from real Claude Code sessions (screenshots, not committed):

1. A subagent ("Check readFile tool truncation and pagination support") got spawned to investigate `readFile`'s truncation/pagination behavior before the main agent touched anything — the reference pattern this spec wants KOINCODE to reproduce reliably.
2. A subagent ("Investigate missed message bug in chat flow") got spawned to root-cause a reported chat bug (missed first message after a mid-conversation model switch) before any fix was attempted.

That same first example's context also surfaced a tangential, separate concern: whether `shell`/bash should be restricted to a safe-command allowlist in PLAN mode, since a model once worked around a truncated `readFile` result by paging through the file manually via bash. That's a permissions/incognito-mode scoping question, not an exploration-delegation one — tracked against `50-incognito-mode-implementation.md` / the `10.x` permission specs instead, not here. (Separately, the specific truncation-workaround failure mode is already guarded against by the existing `readFile`/`nextOffset` rule in `system-prompt.ts`'s Tool Usage section.)

## Decision

Current state before this change: delegating exploration to `spawnAgent` was only ever a soft preference in the system prompt ("prefer `spawnAgent`... for open-ended/broad exploration") — advisory wording with no bright line for when delegation was mandatory, so the main agent could always rationalize a given case as not "broad enough" and just explore inline.

Chosen fix (prompt-only, no tool-availability or mechanical-gating changes): reworded the rule into a hard requirement with a narrow, named exception list instead of a fuzzy "broad/open-ended" threshold. Delegation to `spawnAgent` is now the default for any code not already read in the conversation; skipping it requires *all three* of: user named the exact file/symbol, a single `readFile`/`grep` call suffices, and no cross-file reasoning is needed. Manually chaining `grep` → `readFile` → `grep` to build understanding is explicitly called out as the anti-pattern to avoid.

Rejected alternatives:
- **Mechanical nudge** (track exploration-tool-call count per turn, inject a reminder past a threshold) — more robust but adds server-side state and complexity; deferred unless the prompt-only change proves insufficient in practice.
- **Structural restriction** (remove `grep`/`glob`/`readFile` from the main agent's tool set) — most rigid, but adds latency/overhead to trivial lookups and a larger blast radius on `packages/shared/src/schemas.ts` tool contracts; not pursued.

## Status

Implemented (prompt-only). Updated `packages/server/src/prompts/system-prompt.ts`: `getToolUsageSection`'s rule #5 and `getOperationalSection`'s Workflow step 1 both rewritten per the Decision above. No changes to tool contracts, schemas, or the subagent (`spawnAgent`) implementation itself — `13-subagent-tool-implementation.md` already covers that machinery.

## Follow-up: findings accuracy

Delegating exploration is only useful if the sub-agent's report can be trusted or at least checked — raised as a follow-on question once the enforcement rule above was in place: how do we know a `spawnAgent` finding is accurate rather than plausible-sounding prose? Reference point for what "accurate" looks like: a separate Claude Code session (not KOINCODE's own agent, not yet live-tested against this codebase) investigating a real bug in this repo cited exact `path:line` for every claim, and the main agent independently re-read the cited files before answering the user rather than repeating the sub-agent's claim verbatim.

Three levers considered, in increasing cost: (1) require `path:line` citations + explicit observed-vs-inferred labeling in the sub-agent's own output shape, (2) always attach a "files examined" trail to the result, not just on timeout/max-steps, (3) require the main agent to re-`readFile` a sub-agent's cited lines before writing code based on them (not before merely relaying a finding to the user). All three implemented — the example above hit exactly this combination organically (citations + independent re-read before acting), so it was adopted rather than treated as a hypothetical.

**Status:** Implemented.
- `packages/cli/src/tools/spawn-agent.ts`: `finalOutputInstructions` gained a rule requiring a `path:line` citation for every factual code claim, and explicit "not confirmed" labeling for anything inferred rather than tool-confirmed this run. New `collectExaminedFiles(messages)` (dedups `readFile`/`grep`/`glob`/`listDirectory` calls via the existing `summarizeToolCall` formatter) is now appended as a `Files examined: ...` trail to every successful return, not just the timeout/max-steps fallback paths that already had `collectPartialProgress`.
- `packages/server/src/prompts/system-prompt.ts`: new rule 6 in `getToolUsageSection` ("Verify before acting on a sub-agent's findings") — the main agent must `readFile` a cited location before editing code based on it; relaying a finding to the user doesn't require re-verification first. Renumbered the following rules (old 6→7, and the BUILD-only rules 7/8→8/9) to keep the list sequential.
- `bun run --cwd packages/cli tsc --noEmit` / `bun run --cwd packages/server tsc --noEmit` clean.
- **Not verified live** — no real TTY session in this environment to confirm citations actually show up in practice or that the main agent actually re-reads before editing; prompt/formatting change only.
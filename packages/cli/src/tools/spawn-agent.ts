/**
 * Headless sub-agent runner.
 *
 * Runs a full LLM loop on behalf of a delegated task, executing tool calls
 * locally, handling mode switches silently, and returning the final text result.
 * No React, no UI — purely async.
 */

import type { LanguageModelUsage } from "ai";

import {
  resolveAgent,
  type AgentId,
  toolInputSchemas,
  type WorkspaceRoot,
  type AuxCostEntry,
  type ModelPricing,
  SERVER_PORT
} from "@koincode/shared";
import { executeLocalTool } from "./index";
import { loadAgents } from "../lib/agents";
import { getPermissionInfo } from "../utils/permissions";
import { isAllowedByAgentOverlay } from "../utils/permissions/agent-overlay";
import { isPermittedForProject } from "../utils/configs/project-config";
import { fetchWithRestart } from "../lib/api-client";
import { getInstructionFilesForRequest } from "../lib/instruction-files";

const MAX_STEPS = 50;
const AGENT_STEP_URL = `http://localhost:${SERVER_PORT}/chat/agent-step`;

// Forced wrap-up phase sizing: how many extra turns a sub-agent gets to
// synthesize a final answer after breaching its turn/deadline budget, and the
// wall-clock ceiling on those turns regardless of turn usage.
const WRAPUP_STEPS = 3;
const WRAPUP_GRACE_MS = 90_000;

const WRAPUP_PROMPT = [
  "HARD LIMIT REACHED — your budget for this task is exhausted.",
  "Stop exploring. Do not start any new lines of investigation.",
  "Immediately produce your final answer based ONLY on what you have already gathered, in the required output shape:",
  "1. one-sentence outcome, 2. key findings with path:line citations, 3. blockers/caveats.",
  "Explicitly note anything you did not get to, so the parent knows what remains unknown.",
].join("\n");

// Marks a step exchange where the endpoint violated its contract — HTTP error
// status or an unparseable response body — as opposed to a transport-level
// connection failure. The loop fails loud on these (masking a broken server
// behind a soft "partial progress" result would hide real defects), while
// connection drops degrade gracefully to preserve accumulated work.
class StepContractError extends Error {}

// These are the shapes of messages the agent-step endpoint accepts.
// We use loose types here to avoid fighting with the complex nested generics
// in the ai SDK's ModelMessage type — the endpoint validates structurally.
type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | AssistantContentPart[] }
  | { role: "tool"; content: ToolResultPart[] }
  | { role: "system"; content: string };

type AssistantContentPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };

type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: { type: "text"; value: string };
  isError?: boolean;
};

type AgentStepResponse = {
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    type: string;
  }>;
  finishReason: string;
  usage?: LanguageModelUsage;
  model?: string;
  pricing?: ModelPricing;
};

// type SubagentDefinition = {
//   name: string;
//   description: string;
//   goalPrompt: string;
//   allowedTools?: string[];
//   maxTurns?: number;
//   timeoutSeconds?: number;
// };

type SpawnAgentInput = {
  name: string;
  description: string;
  task: string;
  startingMode?: AgentId;
  /** The model to use — inherits from parent agent */
  model: string;
  goalPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutSeconds?: number;
  /** Aborts the loop between steps (and the in-flight step request) when triggered. */
  signal?: AbortSignal;
  /** Parent session's workspace roots — without these the sub-agent gets neither the
   * eager AGENTS.md/CLAUDE.md tier (its system prompt) nor the nested tier (its readFile
   * calls have no root to bound the walk against, so it's silently a no-op). Also fixes
   * tool-output paths always rendering absolute instead of root-relative for the same reason. */
  roots?: WorkspaceRoot[];
  /** When set, each /agent-step request carries this session id so the server can
   *  persist the step's token usage against the session (recovered on reload). */
  sessionId?: string;
  /** Invoked with each step's usage/model so the parent session can reflect the
   *  cost live in the info bar as the sub-agent runs. */
  onUsage?: (entry: AuxCostEntry) => void;
};

// Compact one-liner for a tool call the sub-agent made but never narrated —
// e.g. `readFile(src/index.ts)` or `grep(TODO src)` — so a run that hit its
// limit mid-tool-call-chain still shows *what it was doing*, not just that it
// stopped.
function summarizeToolCall(part: { toolName: string; input: unknown }): string {
  const args =
    part.input && typeof part.input === "object"
      ? Object.values(part.input as Record<string, unknown>)
          .filter((v) => v !== undefined && v !== "")
          .map(String)
          .join(" ")
      : "";
  return args ? `${part.toolName}(${args})` : part.toolName;
}

// Gathers every text fragment and tool call the sub-agent produced across all
// its turns — used as a fallback when it doesn't finish cleanly (timeout / max
// steps), so that work already done isn't silently discarded in favor of a
// placeholder string, or just whatever text happened to be attached to the
// very last (still tool-calling) turn. Tool calls are included, not just text,
// because a run that ran out of turns mid-research may have made several tool
// calls with zero narration attached — text-only collection would find
// nothing to show even though real work happened.
const EXPLORATION_TOOLS = new Set(["readFile", "grep", "glob", "listDirectory"]);

// Compact, deduped list of files/patterns the sub-agent actually looked at
// (readFile/grep/glob/listDirectory calls across the whole run) — appended to
// every successful return so the parent (and the user) has something to
// spot-check the sub-agent's cited claims against, instead of just its prose.
function collectExaminedFiles(messages: AgentMessage[]): string[] {
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type === "tool-call" && EXPLORATION_TOOLS.has(part.toolName)) {
        seen.add(summarizeToolCall(part));
      }
    }
  }
  return [...seen];
}

function collectPartialProgress(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (typeof m.content === "string") {
      if (m.content) parts.push(m.content);
      continue;
    }
    for (const part of m.content) {
      if (part.type === "text" && part.text) {
        parts.push(part.text);
      } else if (part.type === "tool-call") {
        parts.push(`→ ${summarizeToolCall(part)}`);
      }
    }
  }
  return parts.join("\n");
}

// Sub-agent analogue of `extractLoadedAgentsMd` (lib/instruction-files.ts) — same purpose
// (don't re-attach a nested AGENTS.md's content in a `<system-reminder>` if it's already
// been shown, unless it's changed since), but over this file's own `AgentMessage`/
// `ToolResultPart` shape rather than the main session's UIMessage tool parts. A sub-agent
// run has no `/clear`/`/compact` concept — it's a single bounded loop — so unlike the main
// session there's no boundary to slice against; the full accumulated history is always
// in scope for this scan.
export function extractLoadedAgentsMdFromMessages(messages: AgentMessage[]): Map<string, string> {
  const loaded = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.toolName !== "readFile" || part.isError) continue;
      try {
        const output = JSON.parse(part.output.value) as { loadedAgentsMd?: unknown };
        if (!Array.isArray(output.loadedAgentsMd)) continue;
        for (const entry of output.loadedAgentsMd) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as { path?: unknown }).path === "string" &&
            typeof (entry as { content?: unknown }).content === "string"
          ) {
            const { path, content } = entry as { path: string; content: string };
            loaded.set(path, content);
          }
        }
      } catch {
        continue;
      }
    }
  }
  return loaded;
}

// export const CODE_REVIEWER: SubagentDefinition = {
//   name: "code_reviewer",
//   description:
//     "Reviews code changes and provides feedback on quality, bugs, and improvements",
//   goalPrompt: `You are a code review specialist.
// Your job is to review code and provide constructive feedback.
// Look for bugs, code smells, security issues, and improvement opportunities.
// Use readFile, listDir, grep, writeFile, and editFile to examine and modify the code.
// When you find issues, implement the fixes directly.
// Provide a summary of all changes made at the end.`,
//   allowedTools: ["readFile", "listDirectory", "grep", "writeFile", "editFile"],
//   maxTurns: 10,
//   timeoutSeconds: 300,
// };

export async function runSpawnAgent(input: SpawnAgentInput): Promise<string> {
  const {
    name,
    description,
    task,
    startingMode = "PLAN",
    model,
    goalPrompt,
    allowedTools,
    maxTurns,
    timeoutSeconds,
    signal,
    roots = [],
    sessionId,
    onUsage,
  } = input;

  // The sub-agent runs *as* a registry agent (Feature 54, step d). `startingMode`
  // is an agent id now — "PLAN"/"BUILD" for the built-ins, or a user-defined agent,
  // which brings its own instructions, tool restrictions and model with it.
  const availableAgents = loadAgents();
  let currentAgent = resolveAgent(startingMode, availableAgents);
  let currentMode: AgentId = currentAgent.id;
  const maxSteps = maxTurns ?? MAX_STEPS;

  // A user-defined agent's own `model:` wins over the caller's choice — pinning a
  // model is the main reason to define one (e.g. a cheap reviewer). Falls through to
  // the inherited/configured model when the agent doesn't pin one.
  const effectiveModel = currentAgent.model ?? model;

  // Wrap the task with sub-agent guardrails — keeps the LLM focused on
  // the specific delegation goal and signals it should be concise.
  const finalOutputInstructions = [
    `- When finished, give your final response in this shape:`,
    `  1. One-sentence outcome — what you found or did, and whether it succeeded`,
    `  2. Key findings or changes as short bullet points — specific file paths, values, or facts the parent agent can act on directly, not a narration of your process`,
    `  3. Anything the parent should know before proceeding — blockers, uncertainty, files touched`,
    `- Skip sections that don't apply (e.g. no "changes" section for a pure research task) — don't pad with empty headers`,
    `- Cite a \`path:line\` for every factual claim about the code (e.g. "chat.ts:158", not "somewhere in chat.ts"). If you're inferring or guessing rather than something a tool call actually confirmed this run, say so explicitly (e.g. "likely X — not confirmed, didn't check Y") instead of stating it as fact.`,
  ];

  // A user-defined agent's markdown body is its standing instructions — it takes the
  // place of the generic "you are a sub-agent named X" preamble, while the task and
  // output-shape rules below still apply on top.
  const rolePrompt = goalPrompt ?? currentAgent.prompt;

  const subagentPrompt = rolePrompt
    ? [
        rolePrompt,
        ``,
        `YOUR TASK:`,
        task,
        ``,
        `IMPORTANT:`,
        `- Focus only on completing the specified task`,
        `- Do not engage in unrelated actions`,
        ...finalOutputInstructions,
      ].join("\n")
    : [
        `You are a specialized sub-agent (${name}) with a specific task to complete.`,
        `${description}`,
        ``,
        `YOUR TASK:`,
        task,
        ``,
        `IMPORTANT:`,
        `- Focus only on completing the specified task`,
        `- Do not engage in unrelated actions`,
        ...finalOutputInstructions,
      ].join("\n");

  const messages: AgentMessage[] = [{ role: "user", content: subagentPrompt }];

  // Set up timeout if specified
  const deadline = timeoutSeconds ? Date.now() + timeoutSeconds * 1000 : null;

  // Why the normal budget was breached (e.g. "timeout (600s)") — null until the
  // forced wrap-up phase begins, and used to label the final result honestly.
  let breachReason: string | null = null;
  let wrapUpDeadline: number | null = null;

  // Hard upper bound, visible in the loop condition itself: the normal budget
  // plus the fixed wrap-up allowance. The last WRAPUP_STEPS iterations ARE the
  // wrap-up phase — nothing below can extend the loop; the only early exit is
  // the wrap-up's own grace deadline.
  const totalSteps = maxSteps + WRAPUP_STEPS;

  for (let step = 0; step < totalSteps; step++) {
    const outOfTime = deadline !== null && Date.now() > deadline;

    if (breachReason === null && (step >= maxSteps || outOfTime)) {
      // First budget breach — don't kill the run mid-tool-call, where narration is
      // sparsest and everything it read but never wrote down would die with the
      // conversation (the parent's only recovery is re-spawning cold). Instead,
      // grant a short wrap-up phase to convert accumulated findings into a final
      // answer, which *does* survive via the normal completion path.
      breachReason = outOfTime ? `timeout (${timeoutSeconds}s)` : `step limit (${maxSteps})`;
      messages.push({ role: "user", content: WRAPUP_PROMPT });
      // A run that breached on turns may still have caller-approved time left —
      // respect that ceiling when it's tighter than our own grace window.
      wrapUpDeadline =
        outOfTime || deadline === null  // breached on TIME, or no timeout was set?
          ? Date.now() + WRAPUP_GRACE_MS  // → grace = now + 90s
          : Math.min(Date.now() + WRAPUP_GRACE_MS, deadline);  // → grace = whichever comes first
    } else if (
      breachReason !== null &&
      wrapUpDeadline !== null &&
      Date.now() > wrapUpDeadline
    ) {
      // Wrap-up grace window expired mid-phase.
      break;
    }

    if (signal?.aborted) {
      throw new Error("Sub-agent cancelled");
    }

    // Fetch + parse the next step. A transport-level crash here (connection
    // died even after fetchWithRestart's restart-and-retry) must not discard
    // everything already accumulated in `messages` — degrade to the same
    // partial-progress return used for budget exhaustion. Contract violations
    // (HTTP error status, malformed JSON) and deliberate user cancellation
    // still propagate as errors — see StepContractError.
    let stepResult: AgentStepResponse;
    try {
      const response = await fetchWithRestart(AGENT_STEP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Read fresh every step, same as the main session's prepareSendMessagesRequest —
        // cheap, and picks up a mid-run edit rather than caching a stale snapshot.
        body: JSON.stringify({
          messages,
          mode: currentMode,
          agent: {
            id: currentAgent.id,
            label: currentAgent.label,
            description: currentAgent.description,
            kind: currentAgent.kind,
            tools: [...currentAgent.tools],
            // The role prompt is already folded into the task message above, so it's
            // deliberately not repeated as a system-prompt section here.
            builtin: currentAgent.builtin,
            allowsBrowserTools: currentAgent.allowsBrowserTools,
          },
          model: effectiveModel,
          instructionFiles: getInstructionFilesForRequest(roots),
          ...(sessionId ? { sessionId } : {}),
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => String(response.status));
        throw new StepContractError(
          `Sub-agent step failed (${response.status}): ${errorText}`,
        );
      }

      // An unparseable body is an endpoint contract violation (server bug), not
      // a transient condition — convert to StepContractError so the catch below
      // fails loud instead of degrading to partial progress.
      stepResult = (await response.json().catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        throw new StepContractError(
          `Sub-agent step returned malformed JSON (${reason}).`,
        );
      })) as AgentStepResponse;
    } catch (err) {
      if (signal?.aborted) throw err;
      // Fail loud on contract violations; only transport-level failures reach
      // the graceful fallback below.
      if (err instanceof StepContractError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      
      const partial = collectPartialProgress(messages);
      return partial
        ? `(Sub-agent lost its connection mid-run (${reason}) — here's its progress so far:)\n\n${partial}`
        : `(Sub-agent lost its connection before producing any output: ${reason})`;
    }

    // Surface this step's token usage/model so the parent session can reflect
    // the cost live in the info bar (the server also persists it via sessionId).
    if (stepResult.usage) {
      onUsage?.({
        kind: "agent-step",
        model: stepResult.model ?? effectiveModel,
        ...(stepResult.pricing ? { pricing: stepResult.pricing } : {}),
        usage: stepResult.usage,
      });
    }

    // Build assistant message content from text + tool calls.
    const assistantContent: AssistantContentPart[] = [];

    if (stepResult.text) {
      assistantContent.push({ type: "text", text: stepResult.text });
    }

    for (const tc of stepResult.toolCalls) {
      assistantContent.push({
        type: "tool-call",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      });
    }

    messages.push({
      role: "assistant",
      content:
        assistantContent.length > 0
          ? assistantContent
          : (stepResult.text ?? ""),
    });

    // Stop if no more tool calls.
    if (
      stepResult.finishReason !== "tool-calls" ||
      stepResult.toolCalls.length === 0
    ) {
      const text = stepResult.text ?? "";

      // An errored step is most often a server-side step timeout, which the server
      // returns gracefully (finishReason "error") instead of a masked 500. Don't
      // let the work the sub-agent already produced vanish behind the timeout note
      // — append its accumulated progress, mirroring the local timeout / max-steps
      // fallbacks below.
      const partial =
        stepResult.finishReason === "error"
          ? collectPartialProgress(messages)
          : "";
      const body = partial ? text + "\n\n" + partial : text;

      const examined = collectExaminedFiles(messages);
      const wrapUpNote = breachReason
        ? `\n\n(Sub-agent hit its ${breachReason} mid-run and only finished via a forced wrap-up — findings may be incomplete.)`
        : "";
      return examined.length > 0
        ? `${body}${wrapUpNote}\n\nFiles examined: ${examined.join(", ")}`
        : body + wrapUpNote;
    }

    // Execute each tool call and collect results.
    const toolResults: ToolResultPart[] = [];

    for (const tc of stepResult.toolCalls) {
      // Filter tools based on allowedTools list
      if (allowedTools && !allowedTools.includes(tc.toolName)) {
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: "text",
            value: JSON.stringify({
              error: `Tool ${tc.toolName} is not allowed for this sub-agent`,
            }),
          },
          isError: true,
        });
        continue;
      }

      // switchMode: update local agent silently, no UI. Resolved through the registry
      // so an unknown target degrades to BUILD rather than setting a bogus mode that
      // would then fail every subsequent tool gate.
      if (tc.toolName === "switchMode") {
        const { target } = toolInputSchemas.switchMode.parse(tc.input);
        const nextAgent = resolveAgent(target, availableAgents);
        const result =
          currentAgent.id === nextAgent.id
            ? `already in ${nextAgent.id} mode`
            : `switched to ${nextAgent.id} mode`;
        if (currentAgent.id !== nextAgent.id) {
          currentAgent = nextAgent;
          currentMode = nextAgent.id;
        }
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: { type: "text", value: JSON.stringify({ result }) },
        });
        continue;
      }

      // spawnAgent: nested sub-agents are not supported (prevent unbounded recursion).
      if (tc.toolName === "spawnAgent") {
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: "text",
            value: JSON.stringify({
              error: "Nested sub-agent spawning is not supported.",
            }),
          },
          isError: true,
        });
        continue;
      }

      // askUser: sub-agents run headlessly — no user interaction available.
      if (tc.toolName === "askUser") {
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: "text",
            value: JSON.stringify({
              cancelled: true,
              reason: "Sub-agents cannot prompt the user.",
            }),
          },
        });
        continue;
      }

      // Permission gate: project-level permissions only (no UI prompts — sub-agents
      // run headlessly). Grants are read under *this* agent's id, so a sub-agent
      // running as a restricted custom agent doesn't inherit approvals the user gave
      // while working in BUILD (Decision 9). Its own `allow` overlay still applies,
      // bounded by the same normal-tier-only rule as the main session (Decision 6).
      const permInfo = getPermissionInfo(tc.toolName, tc.input);

      if (
        permInfo.requiresApproval &&
        !isAllowedByAgentOverlay(permInfo, currentAgent.permission, tc.toolName) &&
        !isPermittedForProject(permInfo.key, currentAgent.id)
      ) {
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: "text",
            value: JSON.stringify({
              denied: true,
              reason: `Permission not pre-approved for: ${permInfo.key}`,
            }),
          },
          isError: true,
        });
        continue;
      }

      // Execute the tool locally.
      try {
        const toolOutput = await executeLocalTool(
          tc.toolName,
          tc.input,
          currentMode,
          effectiveModel,
          undefined,
          roots,
          tc.toolName === "readFile" ? extractLoadedAgentsMdFromMessages(messages) : undefined,
        );
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: { type: "text", value: JSON.stringify(toolOutput) },
        });
      } catch (err) {
        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: "text",
            value: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          },
          isError: true,
        });
      }
    }

    messages.push({
      role: "tool",
      content: toolResults,
    });
  }

  // Wrap-up budget exhausted without ever naturally concluding — collect everything
  // it produced across all turns rather than just whatever text (often a
  // fragment like "let me check X next") happened to be attached to the very
  // last turn, which by definition also still had tool calls pending.
  const partial = collectPartialProgress(messages);
  return partial
    ? `(Sub-agent hit its ${breachReason} and didn't fully finish even after a forced wrap-up — here's its best effort; anything it didn't report is unknown:)\n\n${partial}`
    : "(Sub-agent exhausted its budget without producing any output.)";
}

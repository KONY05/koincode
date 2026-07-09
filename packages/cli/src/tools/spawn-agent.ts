/**
 * Headless sub-agent runner.
 *
 * Runs a full LLM loop on behalf of a delegated task, executing tool calls
 * locally, handling mode switches silently, and returning the final text result.
 * No React, no UI — purely async.
 */

import { type ModeType, toolInputSchemas } from "@koincode/shared";
import { executeLocalTool } from "./index";
import { getPermissionInfo } from "../utils/permissions";
import { isPermittedForProject } from "../utils/configs/project-config";
import { fetchWithRestart } from "../lib/api-client";
import { SERVER_PORT } from "@koincode/shared";

const MAX_STEPS = 50;
const AGENT_STEP_URL = `http://localhost:${SERVER_PORT}/chat/agent-step`;

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
  startingMode?: ModeType;
  /** The model to use — inherits from parent agent */
  model: string;
  goalPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutSeconds?: number;
  /** Aborts the loop between steps (and the in-flight step request) when triggered. */
  signal?: AbortSignal;
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
  } = input;

  let currentMode: ModeType = startingMode;
  const maxSteps = maxTurns ?? MAX_STEPS;

  // Wrap the task with sub-agent guardrails — keeps the LLM focused on
  // the specific delegation goal and signals it should be concise.
  const finalOutputInstructions = [
    `- When finished, give your final response in this shape:`,
    `  1. One-sentence outcome — what you found or did, and whether it succeeded`,
    `  2. Key findings or changes as short bullet points — specific file paths, values, or facts the parent agent can act on directly, not a narration of your process`,
    `  3. Anything the parent should know before proceeding — blockers, uncertainty, files touched`,
    `- Skip sections that don't apply (e.g. no "changes" section for a pure research task) — don't pad with empty headers`,
  ];

  const subagentPrompt = goalPrompt
    ? [
        goalPrompt,
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

  for (let step = 0; step < maxSteps; step++) {
    // Check timeout
    if (deadline && Date.now() > deadline) {
      const partial = collectPartialProgress(messages);
      return partial
        ? `(Sub-agent timed out before finishing — here's its progress so far:)\n\n${partial}`
        : "(Sub-agent timed out before producing any output.)";
    }

    if (signal?.aborted) {
      throw new Error("Sub-agent cancelled");
    }

    const response = await fetchWithRestart(AGENT_STEP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, mode: currentMode, model }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => String(response.status));
      throw new Error(
        `Sub-agent step failed (${response.status}): ${errorText}`,
      );
    }

    const stepResult = (await response.json()) as AgentStepResponse;

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
      return stepResult.text ?? "";
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

      // switchMode: update local mode silently, no UI.
      if (tc.toolName === "switchMode") {
        const { target } = toolInputSchemas.switchMode.parse(tc.input);
        const result =
          currentMode === target
            ? `already in ${target} mode`
            : `switched to ${target} mode`;
        if (currentMode !== target) {
          currentMode = target;
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

      // Permission gate: use project-level permissions only (no UI prompts).
      const permInfo = getPermissionInfo(tc.toolName, tc.input);

      if (permInfo.requiresApproval && !isPermittedForProject(permInfo.key)) {
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
          model,
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

  // Exceeded max steps without ever naturally concluding — collect everything
  // it produced across all turns rather than just whatever text (often a
  // fragment like "let me check X next") happened to be attached to the very
  // last turn, which by definition also still had tool calls pending.
  const partial = collectPartialProgress(messages);
  return partial
    ? `(Sub-agent hit its step limit (${maxSteps}) before finishing — here's its progress so far:)\n\n${partial}`
    : "(Sub-agent reached maximum steps without producing any output.)";
}

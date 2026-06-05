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

type SubagentDefinition = {
  name: string;
  description: string;
  goalPrompt: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutSeconds?: number;
};

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
};

export const CODE_REVIEWER: SubagentDefinition = {
  name: "code_reviewer",
  description:
    "Reviews code changes and provides feedback on quality, bugs, and improvements",
  goalPrompt: `You are a code review specialist.
Your job is to review code and provide constructive feedback.
Look for bugs, code smells, security issues, and improvement opportunities.
Use readFile, listDir, grep, writeFile, and editFile to examine and modify the code.
When you find issues, implement the fixes directly.
Provide a summary of all changes made at the end.`,
  allowedTools: ["readFile", "listDirectory", "grep", "writeFile", "editFile"],
  maxTurns: 10,
  timeoutSeconds: 300,
};

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
  } = input;

  let currentMode: ModeType = startingMode;
  const maxSteps = maxTurns ?? MAX_STEPS;

  // Wrap the task with sub-agent guardrails — keeps the LLM focused on
  // the specific delegation goal and signals it should be concise.
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
        `- Once you have completed the task or have the answer, provide your final response`,
        `- Be concise and direct in your output`,
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
        `- Once you have completed the task or have the answer, provide your final response`,
        `- Be concise and direct in your output`,
      ].join("\n");

  const messages: AgentMessage[] = [{ role: "user", content: subagentPrompt }];

  // Set up timeout if specified
  const deadline = timeoutSeconds ? Date.now() + timeoutSeconds * 1000 : null;

  for (let step = 0; step < maxSteps; step++) {
    // Check timeout
    if (deadline && Date.now() > deadline) {
      return "(Sub-agent timed out)";
    }

    const response = await fetchWithRestart(AGENT_STEP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, mode: currentMode, model }),
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

  // Exceeded max steps — return whatever text we have from the last assistant message.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (lastAssistant && lastAssistant.role === "assistant") {
    const content = lastAssistant.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const textParts = content.filter(
        (p): p is { type: "text"; text: string } => p.type === "text",
      );
      return textParts.map((p) => p.text).join("\n");
    }
  }
  return "(Sub-agent reached maximum steps without producing a final answer.)";
}

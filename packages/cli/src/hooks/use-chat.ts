import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

import {
  type ChatMessageMetadata,
  getContextWindow,
  Mode,
  type ModeType,
  type ToolContracts,
  toolInputSchemas,
} from "@koincode/shared";
import { apiClient } from "../lib/api-client";
import { executeLocalTool } from "../tools";
import { loadSkillsManifest } from "../lib/skills";
import { runSpawnAgent } from "../tools/spawn-agent";
import { getPermissionInfo } from "../utils/permissions";
import {
  allowForProject,
  isPermittedForProject,
  readProjectConfig,
} from "../utils/configs/project-config";
import { usePromptConfig } from "../providers/prompt-config";
import type { ApprovalResponse, PendingApproval } from "../utils/permissions";
import type {
  PendingModeSwitch,
  ModeSwitchResponse,
} from "../components/widget/mode-switch-widget";
import { runHooks } from "../utils/hooks";

export type PendingUserQuestion = {
  question: string;
  options: { label: string; value: string }[];
  allowFreeText: boolean;
};

export type SystemEvent = {
  id: string;
  text: string;
  afterMessageCount: number;
};

export type ContextUsage = {
  tokensUsed: number;
  contextWindow: number;
  percent: number;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export function useChat(sessionId: string, initialMessages: Message[], initialSystemEvents: SystemEvent[] = []) {
  const { mode, setMode, autoModeSwitch, setAutoModeSwitch } =
    usePromptConfig();

  const [wasInterrupted, setWasInterrupted] = useState(false);
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [pendingUserQuestion, setPendingUserQuestion] =
    useState<PendingUserQuestion | null>(null);
  const [pendingModeSwitch, setPendingModeSwitch] =
    useState<PendingModeSwitch | null>(null);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>(initialSystemEvents);
  const [isSubagentRunning, setIsSubagentRunning] = useState(false);

  const resolveApprovalRef = useRef<((r: ApprovalResponse) => void) | null>(
    null,
  );
  const resolveUserQuestionRef = useRef<
    ((value: string | null) => void) | null
  >(null);
  const resolveModeSwitchRef = useRef<((r: ModeSwitchResponse) => void) | null>(
    null,
  );

  // Shared mutex — serializes approvals, askUser, and mode switch widgets so only one shows at a time.
  const interactionMutexRef = useRef<Promise<void>>(Promise.resolve());

  // Tracks the effective mode synchronously across tool calls within a streaming turn.
  const currentModeRef = useRef<ModeType>(mode);
  const autoModeSwitchRef = useRef(autoModeSwitch);
  const setModeRef = useRef(setMode);
  const setAutoModeSwitchRef = useRef(setAutoModeSwitch);

  useEffect(() => {
    currentModeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    autoModeSwitchRef.current = autoModeSwitch;
  }, [autoModeSwitch]);
  useEffect(() => {
    setModeRef.current = setMode;
  }, [setMode]);
  useEffect(() => {
    setAutoModeSwitchRef.current = setAutoModeSwitch;
  }, [setAutoModeSwitch]);

  const transport = useMemo(() => {
    return new DefaultChatTransport<Message>({
      api: apiClient.chat.$url().toString(),
      prepareSendMessagesRequest({ messages }) {
        const message = messages[messages.length - 1];
        if (!message) throw new Error("No message to send");

        const metadata = messages.findLast(
          (m) => m.metadata?.mode && m.metadata?.model,
        )?.metadata;
        const previousMessage = messages[messages.length - 2];

        // If the previous assistant message was interrupted, do NOT send it back —
        // it's already saved (clean, without pending tool calls) on the server.
        // Sending it would cause validateUIMessages to throw on the next round.
        const previousIsInterrupted =
          previousMessage?.role === "assistant" &&
          previousMessage.metadata?.interrupted;

        const requestMessages =
          !previousIsInterrupted &&
          message.role === "assistant" &&
          previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode,
            model: message.metadata?.model ?? metadata?.model,
            skillsManifest: loadSkillsManifest().map((s) => ({
              name: s.name,
              description: s.description,
              scope: s.scope,
            })),
          },
        };
      },
    });
  }, [sessionId]);

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    onToolCall({ toolCall }) {
      void (async () => {
        // spawnAgent: run a headless sub-agent and return its final text output.
        if (toolCall.toolName === "spawnAgent") {
          const { name, description, task, startingMode } =
            toolInputSchemas.spawnAgent.parse(toolCall.input);

          // Determine the current model from the most recent message metadata.
          const metadata = chat.messages.findLast(
            (m) => m.metadata?.model,
          )?.metadata;
          const model = metadata?.model ?? "openrouter/owl-alpha";

          setIsSubagentRunning(true);
          try {
            const result = await runSpawnAgent({
              name,
              description,
              task,
              startingMode: startingMode ?? "PLAN",
              model: String(model),
            });
            chat.addToolOutput({
              tool: "spawnAgent" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: { result },
            });
          } catch (error) {
            chat.addToolOutput({
              tool: "spawnAgent" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              state: "output-error",
              errorText: error instanceof Error ? error.message : String(error),
            });
          } finally {
            setIsSubagentRunning(false);
          }
          return;
        }

        // askUser: show widget, return user's answer directly.
        if (toolCall.toolName === "askUser") {
          const { question, options, allowFreeText } =
            toolInputSchemas.askUser.parse(toolCall.input);

          const answerPromise = new Promise<string | null>((outerResolve) => {
            interactionMutexRef.current = interactionMutexRef.current
              .then(
                () =>
                  new Promise<void>((releaseMutex) => {
                    resolveUserQuestionRef.current = (value) => {
                      outerResolve(value);
                      releaseMutex();
                    };
                    setPendingUserQuestion({
                      question,
                      options,
                      allowFreeText: allowFreeText ?? false,
                    });
                  }),
              )
              .then(() => {
                setPendingUserQuestion(null);
                resolveUserQuestionRef.current = null;
              });
          });

          const answer = await answerPromise;

          chat.addToolOutput({
            tool: "askUser" as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output: answer !== null ? { value: answer } : { cancelled: true },
          });
          return;
        }

        // switchMode: autonomous mode switching.
        if (toolCall.toolName === "switchMode") {
          const { target, reason } = toolInputSchemas.switchMode.parse(
            toolCall.input,
          );

          // Same-mode guard — no-op.
          if (currentModeRef.current === target) {
            chat.addToolOutput({
              tool: "switchMode" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: { result: `already in ${target} mode` },
            });
            return;
          }

          // BUILD → PLAN or auto config → switch silently.
          if (target === Mode.PLAN || autoModeSwitchRef.current === "auto") {
            setModeRef.current(target);
            currentModeRef.current = target;
            setSystemEvents((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                text: `Switched to ${target} mode`,
                afterMessageCount: chat.messages.length,
              },
            ]);
            chat.addToolOutput({
              tool: "switchMode" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: { result: `switched to ${target} mode` },
            });
            return;
          }

          // PLAN → BUILD with confirm — show ModeSwitchWidget.
          const responsePromise = new Promise<ModeSwitchResponse>(
            (outerResolve) => {
              interactionMutexRef.current = interactionMutexRef.current
                .then(
                  () =>
                    new Promise<void>((releaseMutex) => {
                      resolveModeSwitchRef.current = (r) => {
                        outerResolve(r);
                        releaseMutex();
                      };
                      setPendingModeSwitch({ target, reason });
                    }),
                )
                .then(() => {
                  setPendingModeSwitch(null);
                  resolveModeSwitchRef.current = null;
                });
            },
          );

          const response = await responsePromise;

          if (response.type === "deny") {
            chat.addToolOutput({
              tool: "switchMode" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: { denied: true, reason: "User declined the mode switch" },
            });
            return;
          }

          if (response.type === "always-allow") {
            setAutoModeSwitchRef.current("auto");
          }

          setModeRef.current(target);
          currentModeRef.current = target;
          setSystemEvents((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: `Switched to ${target} mode`,
              afterMessageCount: chat.messages.length,
            },
          ]);
          chat.addToolOutput({
            tool: "switchMode" as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output: { result: `switched to ${target} mode` },
          });
          return;
        }

        // Permission gate for all other tools.
        const extraPatterns = readProjectConfig().sensitivePatterns ?? [];
        // checks if incoming tool call requires approval
        const permInfo = getPermissionInfo(
          toolCall.toolName,
          toolCall.input,
          extraPatterns,
        );

        // checks if tool requires approval and is not permitted for this project
        if (permInfo.requiresApproval && !isPermittedForProject(permInfo.key)) {
          const approval: PendingApproval = {
            key: permInfo.key,
            label: permInfo.label,
            description: permInfo.description,
            tier: permInfo.tier,
          };

          // NOTE: .then is used here (not async/await) because the mutex read-and-update
          // must be atomic. Awaiting inside the Promise constructor would introduce a race
          // if two tool calls arrive in the same tick.
          const responsePromise = new Promise<ApprovalResponse>(
            (outerResolve) => {
              interactionMutexRef.current = interactionMutexRef.current
                .then(
                  () =>
                    // Only runs when the previous approval is done
                    new Promise<void>((releaseMutex) => {
                      resolveApprovalRef.current = (r) => {
                        outerResolve(r);
                        releaseMutex();
                      };
                      setPendingApproval(approval);
                    }),
                )
                .then(() => {
                  setPendingApproval(null); // hides the widget after mutex releases
                  resolveApprovalRef.current = null;
                });
            },
          );

          const response = await responsePromise;

          if (response.type === "deny") {
            chat.addToolOutput({
              tool: toolCall.toolName as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: { denied: true, reason: "User rejected this action" },
            });
            return;
          }

          if (response.type === "allow-for-project") {
            allowForProject(permInfo.key);
          }
        }

        // Run PreToolUse hooks after permission check
        const preHookResults = await runHooks(
          "PreToolUse",
          toolCall.toolName,
          toolCall.input,
        );

        // If any PreToolUse hook exits with non-zero code, deny the tool
        const failedHook = preHookResults.find((r) => r.exitCode !== 0);
        if (failedHook) {
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output: {
              denied: true,
              reason: failedHook.stderr || "Tool execution denied by hook",
            },
          });
          return;
        }

        const toolInput = toolCall.input;

        try {
          const output = await executeLocalTool(
            toolCall.toolName,
            toolInput,
            currentModeRef.current,
          );
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output,
          });
        } catch (error) {
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const contextUsage = useMemo((): ContextUsage | null => {
    const lastWithUsage = [...chat.messages].reverse().find(
      (m) => m.role === "assistant" && m.metadata?.usage,
    );
    if (!lastWithUsage?.metadata?.usage) return null;

    const modelId = lastWithUsage.metadata.model ?? "";
    const contextWindow = getContextWindow(String(modelId));
    const tokensUsed = lastWithUsage.metadata.usage.inputTokens ?? 0;
    return {
      tokensUsed,
      contextWindow,
      percent: Math.min(100, Math.round((tokensUsed / contextWindow) * 100)),
    };
  }, [chat.messages]);

  const resolveApproval = useCallback((response: ApprovalResponse) => {
    resolveApprovalRef.current?.(response);
  }, []);

  const resolveUserQuestion = useCallback((value: string | null) => {
    resolveUserQuestionRef.current?.(value);
  }, []);

  const resolveModeSwitch = useCallback((response: ModeSwitchResponse) => {
    resolveModeSwitchRef.current?.(response);
  }, []);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    wasInterrupted,
    pendingApproval,
    resolveApproval,
    pendingUserQuestion,
    resolveUserQuestion,
    pendingModeSwitch,
    resolveModeSwitch,
    systemEvents,
    isSubagentRunning,
    contextUsage,
    addSystemEvent: (text: string) => {
      setSystemEvents((prev) => [
        ...prev,
        { id: crypto.randomUUID(), text, afterMessageCount: chat.messages.length },
      ]);
    },
    submit: (params: {
      userText: string;
      mode: ModeType;
      model: string;
    }) => {
      setWasInterrupted(false);
      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
        },
      });
    },
    abort: chat.stop,
    interrupt: () => {
      setWasInterrupted(true);
      chat.stop();
    },
  };
}

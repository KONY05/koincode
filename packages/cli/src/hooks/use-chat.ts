import { useCallback, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

import {
  type ChatMessageMetadata,
  type ModeType,
  type SupportedChatModelId,
  type ToolContracts,
  toolInputSchemas,
} from "@koincode/shared";
import { apiClient } from "../lib/api-client";
import { executeLocalTool } from "../tools";
import { getPermissionInfo } from "../lib/permissions";
import { allowForProject, isPermittedForProject, readProjectConfig } from "../lib/project-config";
import type { ApprovalResponse, PendingApproval } from "../lib/permissions";

export type { ApprovalResponse, PendingApproval };

export type PendingUserQuestion = {
  question: string;
  options: { label: string; value: string }[];
  allowFreeText: boolean;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export function useChat(sessionId: string, initialMessages: Message[]) {
  const [wasInterrupted, setWasInterrupted] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingUserQuestion, setPendingUserQuestion] = useState<PendingUserQuestion | null>(null);

  const resolveApprovalRef = useRef<((r: ApprovalResponse) => void) | null>(null);
  const resolveUserQuestionRef = useRef<((value: string | null) => void) | null>(null);
  // Shared mutex — serializes approvals and askUser questions so only one widget shows at a time.
  const interactionMutexRef = useRef<Promise<void>>(Promise.resolve());

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
        const requestMessages =
          message.role === "assistant" && previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode,
            model: message.metadata?.model ?? metadata?.model,
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
        const mode = chat.messages.at(-1)?.metadata?.mode ?? "BUILD";

        // askUser: model-initiated question — show widget, return user's answer directly.
        if (toolCall.toolName === "askUser") {
          const { question, options, allowFreeText } = toolInputSchemas.askUser.parse(toolCall.input);

          const answerPromise = new Promise<string | null>((outerResolve) => {
            interactionMutexRef.current = interactionMutexRef.current
              .then(
                () =>
                  new Promise<void>((releaseMutex) => {
                    resolveUserQuestionRef.current = (value) => {
                      outerResolve(value);
                      releaseMutex();
                    };
                    setPendingUserQuestion({ question, options, allowFreeText: allowFreeText ?? false });
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

        // Permission gate for all other tools.
        const extraPatterns = readProjectConfig().sensitivePatterns ?? [];
        // checks if incoming tool call requires approval
        const permInfo = getPermissionInfo(toolCall.toolName, toolCall.input, extraPatterns);

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
          const responsePromise = new Promise<ApprovalResponse>((outerResolve) => {
            interactionMutexRef.current = interactionMutexRef.current
              .then(
                () =>
                  // Only runs when the previous approval is done
                  new Promise<void>((releaseMutex) => {
                    resolveApprovalRef.current = (r) => {
                      outerResolve(r); // resolves the response for the awaiting onToolCall
                      releaseMutex(); // releases the mutex, allowing the next approval to proceed
                    };
                    setPendingApproval(approval); // shows the widget
                  }),
              )
              .then(() => {
                setPendingApproval(null); // hides the widget after mutex releases
                resolveApprovalRef.current = null;
              });
          });

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

        try {
          const output = await executeLocalTool(toolCall.toolName, toolCall.input, mode);
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

  const resolveApproval = useCallback((response: ApprovalResponse) => {
    resolveApprovalRef.current?.(response);
  }, []);

  const resolveUserQuestion = useCallback((value: string | null) => {
    resolveUserQuestionRef.current?.(value);
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
    submit: (params: { userText: string; mode: ModeType; model: SupportedChatModelId }) => {
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

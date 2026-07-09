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
import { sweepOrphanSnapshots } from "../lib/snapshots";
import { hasApiKeyForModel } from "../lib/usage";
import { estimateSessionCost } from "../lib/cost";
import { executeLocalTool } from "../tools";
import { loadSkillsManifest } from "../lib/skills";
import {
  getIdeContextForRequest,
  getIdeSelectionForRequest,
} from "./use-ide-context";
import { readGlobalConfig } from "../utils/configs/global-config";
import { isTerminalFocused } from "../lib/terminal-focus";
import { notifyVsCode } from "../lib/vscode-notify";
import { runSpawnAgent } from "../tools/spawn-agent";
import {
  createBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
  onTaskSettled,
} from "../lib/background/background-tasks";
import {
  registerBackgroundWork,
  cancelAllBackgroundWork,
} from "../lib/background/session-background-work";
import { getPermissionInfo } from "../utils/permissions";
import {
  allowForProject,
  isPermittedForProject,
  readProjectConfig,
} from "../utils/configs/project-config";
import { usePromptConfig } from "../providers/prompt-config";
import { useToast } from "../providers/toast";
import type { ApprovalResponse, PendingApproval } from "../utils/permissions";
import type {
  PendingModeSwitch,
  ModeSwitchResponse,
} from "../components/widget/mode-switch-widget";
import { runHooks } from "../utils/hooks";
import {
  trackMessageSent,
  trackToolExecuted,
  trackModeSwitched,
  trackFeatureUsed,
} from "../lib/analytics";
import { FALLBACK_MODEL_ID } from "../../../shared/src/models";

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
  hasUsageData: boolean;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export type QueuedMessage = {
  userText: string;
  mode: ModeType;
  model: string;
  origin?: ChatMessageMetadata["origin"];
};

// Module-level store invisible to React's strict-mode ref tracking.
// Used by the transport (created inside useMemo) to read the current mode
// after a mid-turn switchMode without accessing a useRef during render.
const _activeModes = new Map<string, ModeType>();

// Pending scheduleWakeup timers keyed by session id — cleared on cancellation
// (a real user message arrives) or when the session unmounts. Process-lifetime
// only, same accepted limitation as the background task registry. `unsubscribe`
// is set when the wakeup is also linked to a background task (waitingOnTaskId)
// — whichever of the timer or the task settling fires first consumes both, so
// the other one never double-fires later.
type PendingWakeup = {
  timeoutId: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
};
const _pendingWakeups = new Map<string, PendingWakeup>();

function clearPendingWakeup(sessionId: string) {
  const existing = _pendingWakeups.get(sessionId);
  if (existing) {
    clearTimeout(existing.timeoutId);
    existing.unsubscribe?.();
    _pendingWakeups.delete(sessionId);
  }
}

// Default "tell the parent when it's done" listener for every background
// spawnAgent task, keyed by taskId — registered the moment the task starts, so
// scheduleWakeup stays optional rather than mandatory pairing. If a
// scheduleWakeup later links to the same task via waitingOnTaskId, it cancels
// this default listener first (see the scheduleWakeup branch) so the task only
// ever delivers once, not twice.
const _defaultTaskListeners = new Map<string, () => void>();

export function useChat(
  sessionId: string,
  initialMessages: Message[],
  initialSystemEvents: SystemEvent[] = [],
) {
  const {
    mode,
    setMode,
    autoModeSwitch,
    setAutoModeSwitch,
    model: currentModel,
  } = usePromptConfig();
  const toast = useToast();

  // Opportunistic, throttled cleanup of orphaned snapshot blobs — the server
  // is already known to be reachable by the time a session is active.
  useEffect(() => {
    void sweepOrphanSnapshots();
  }, []);

  const [wasInterrupted, setWasInterrupted] = useState(false);

  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  useEffect(() => {
    messageQueueRef.current = messageQueue;
  }, [messageQueue]);

  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [pendingUserQuestion, setPendingUserQuestion] =
    useState<PendingUserQuestion | null>(null);
  const [pendingModeSwitch, setPendingModeSwitch] =
    useState<PendingModeSwitch | null>(null);

  const [systemEvents, setSystemEvents] =
    useState<SystemEvent[]>(initialSystemEvents);

  const [isSubagentRunning, setIsSubagentRunning] = useState(false);

  // MCP servers approved for the lifetime of this session (server name → approved).
  const approvedMcpServersRef = useRef<Set<string>>(new Set());
  // Permission keys approved for this session only (e.g. outside-project directory access).
  const sessionApprovedKeysRef = useRef<Set<string>>(new Set());

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

  // Fires when the agent needs the user's attention (turn finished, approval/question/
  // mode-switch prompt shown) — the whole point being to surface this when the user
  // has tabbed away and wouldn't otherwise notice.
  const ringBellIfUnfocused = useCallback(() => {
    const enabled = readGlobalConfig().notificationEnabled ?? true;
    if (!enabled) return;
    if (isTerminalFocused()) return;

    if (process.env.TERM_PROGRAM === "vscode") {
      notifyVsCode("Koincode is waiting for you");
    } else {
      process.stdout.write("\x07");
    }
  }, []);

  _activeModes.set(sessionId, mode);
  const autoModeSwitchRef = useRef(autoModeSwitch);
  const setModeRef = useRef(setMode);
  const setAutoModeSwitchRef = useRef(setAutoModeSwitch);

  useEffect(() => {
    return () => {
      _activeModes.delete(sessionId);
      clearPendingWakeup(sessionId);
      cancelAllBackgroundWork(sessionId);
    };
  }, [sessionId]);

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
            mode: _activeModes.get(sessionId) ?? mode,
            model: message.metadata?.model ?? metadata?.model,
            browserTools: readGlobalConfig().browser?.enabled ?? false,
            skillsManifest: loadSkillsManifest().map((s) => ({
              name: s.name,
              description: s.description,
              scope: s.scope,
            })),
            ideActiveFile: getIdeContextForRequest(),
            ideSelection: getIdeSelectionForRequest(),
          },
        };
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` excluded: recreating transport mid-stream drops the connection; _activeModes map is the primary source
  }, [sessionId]);

  // Shared by scheduleWakeup and the background-spawnAgent default push below.
  // These fire from callbacks registered much earlier (a timer, a settle
  // listener) that may run long after the turn that scheduled them ended — if
  // chat.status is already "ready" by firing time and stays "ready" (no active
  // turn to transition away from), pushing onto messageQueue alone leaves it
  // stuck forever: the auto-drain effect below only re-runs on chat.status
  // *transitions* (its deps are `[chat.status]`), and a queue push doesn't
  // change chat.status. So: check the live status (via chatStatusRef, defined
  // below `chat` — a plain closure read of chat.status here would itself be
  // stale) and send immediately if idle; only queue if a turn is genuinely in
  // progress, since that case *does* end in a real transition the drain effect
  // will catch. chat.sendMessage itself is safe to call from an old closure —
  // unlike chat.status, it's a stable method, not a snapshotted value.
  const queueMessage = (
    userText: string,
    origin?: ChatMessageMetadata["origin"],
  ) => {
    const activeMode = _activeModes.get(sessionId) ?? mode;
    const busy =
      chatStatusRef.current === "submitted" ||
      chatStatusRef.current === "streaming";

    if (busy) {
      setMessageQueue((prev) => [
        ...prev,
        { userText, mode: activeMode, model: currentModel, origin },
      ]);
      return;
    }

    setWasInterrupted(false);
    void chat.sendMessage({
      text: userText,
      metadata: { mode: activeMode, model: currentModel, origin },
    });
  };

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    onToolCall({ toolCall }) {
      void (async () => {
        // spawnAgent: run a headless sub-agent and return its final text output.
        if (toolCall.toolName === "spawnAgent") {
          const {
            name,
            description,
            task,
            startingMode,
            runInBackground,
            maxTurns,
            timeoutSeconds,
          } = toolInputSchemas.spawnAgent.parse(toolCall.input);

          // Determine the current model from the most recent message metadata.
          const metadata = chat.messages.findLast(
            (m) => m.metadata?.model,
          )?.metadata;
          const model = metadata?.model ?? FALLBACK_MODEL_ID;

          // runInBackground: don't block this turn — register the task and return
          // immediately. scheduleWakeup/checkAgentTask are optional, nice-to-have
          // ways to check back sooner or with a specific follow-up prompt — this
          // default listener is what guarantees the result reaches the parent
          // even if the model never calls either.
          if (runInBackground) {
            const taskId = createBackgroundTask(name, description);
            trackFeatureUsed({ feature: "subagent-background" });

            const controller = new AbortController();
            const deregister = registerBackgroundWork(sessionId, () =>
              controller.abort(),
            );

            const unsubscribeDefault = onTaskSettled(taskId, (task) => {
              _defaultTaskListeners.delete(taskId);

              const outcome =
                task.status === "completed"
                  ? `Sub-agent "${name}" (task ${taskId}) finished.\n\nResult:\n${task.result}`
                  : `Sub-agent "${name}" (task ${taskId}) errored: ${task.error}`;

              queueMessage(outcome, "background-task");
            });

            _defaultTaskListeners.set(taskId, unsubscribeDefault);

            void runSpawnAgent({
              name,
              description,
              task,
              startingMode: startingMode ?? "PLAN",
              model: String(model),
              signal: controller.signal,
              maxTurns,
              timeoutSeconds,
            })
              .then((result) => completeBackgroundTask(taskId, result))
              .catch((error) =>
                failBackgroundTask(
                  taskId,
                  error instanceof Error ? error.message : String(error),
                ),
              )
              .finally(deregister);

            chat.addToolOutput({
              tool: "spawnAgent" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: {
                taskId,
                status: "running",
                message: `Sub-agent "${name}" started in background (task ${taskId}). Its result will be delivered here automatically once it finishes — no need to poll. Optionally use checkAgentTask to check sooner, or scheduleWakeup with waitingOnTaskId to also resume with a specific follow-up prompt the moment it's done.`,
              },
            });
            return;
          }

          setIsSubagentRunning(true);
          trackFeatureUsed({ feature: "subagent" });
          try {
            const result = await runSpawnAgent({
              name,
              description,
              task,
              startingMode: startingMode ?? "PLAN",
              model: String(model),
              maxTurns,
              timeoutSeconds,
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

        // scheduleWakeup: defer this session's next continuation instead of
        // blocking or polling. Fires by auto-submitting `prompt` (optionally
        // enriched with a linked task's result) once either the delay elapses
        // or the linked task settles, whichever comes first.
        if (toolCall.toolName === "scheduleWakeup") {
          const { delaySeconds, reason, prompt, waitingOnTaskId } =
            toolInputSchemas.scheduleWakeup.parse(toolCall.input);

          clearPendingWakeup(sessionId);
          trackFeatureUsed({ feature: "schedule-wakeup" });

          const fire = (userText: string) => {
            _pendingWakeups.delete(sessionId);
            queueMessage(userText, "background-task");
          };

          const scheduledFor = Date.now() + delaySeconds * 1000;

          const timeoutId = setTimeout(() => {
            // Timer won first — tear down the task listener too, so a later
            // settle doesn't also fire a second, orphaned resume.
            _pendingWakeups.get(sessionId)?.unsubscribe?.();
            fire(prompt);
          }, delaySeconds * 1000);

          // Cancel the default "tell the parent when it's done" listener for
          // this task — this scheduleWakeup's own listener below supersedes it,
          // so the task only ever delivers once, not twice.
          if (waitingOnTaskId) {
            // calling the unsubscribe from a previous registered task to prevent the task from being called twice
            _defaultTaskListeners.get(waitingOnTaskId)?.();
            _defaultTaskListeners.delete(waitingOnTaskId);
          }

          const unsubscribe = waitingOnTaskId
            ? onTaskSettled(waitingOnTaskId, (task) => {
                // Task won first — the timer is now redundant.
                clearTimeout(timeoutId);
                const outcome =
                  task.status === "completed"
                    ? `Task ${task.id} completed. Result:\n${task.result}`
                    : `Task ${task.id} errored: ${task.error}`;
                fire(`${prompt}\n\n---\n${outcome}`);
              })
            : undefined;

          _pendingWakeups.set(sessionId, { timeoutId, unsubscribe });

          chat.addToolOutput({
            tool: "scheduleWakeup" as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output: {
              scheduledFor: new Date(scheduledFor).toISOString(),
              delaySeconds,
              reason,
              waitingOnTaskId,
            },
          });
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
                    ringBellIfUnfocused();
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
          if (_activeModes.get(sessionId) === target) {
            chat.addToolOutput({
              tool: "switchMode" as keyof ChatTools,
              toolCallId: toolCall.toolCallId,
              output: { result: `already in ${target} mode` },
            });
            return;
          }

          // BUILD → PLAN or auto config → switch silently.
          if (target === Mode.PLAN || autoModeSwitchRef.current === "auto") {
            const from = _activeModes.get(sessionId)!;
            setModeRef.current(target);
            _activeModes.set(sessionId, target);
            trackModeSwitched({ from, to: target });
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
                      ringBellIfUnfocused();
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

          const fromMode = _activeModes.get(sessionId)!;
          setModeRef.current(target);
          _activeModes.set(sessionId, target);
          trackModeSwitched({ from: fromMode, to: target });
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

        // MCP approval gate — fires before the standard permission check.
        // Asks once per server per session; "Allow for session" skips future prompts.
        if (toolCall.toolName.includes("__")) {
          const serverName = toolCall.toolName.split("__")[0]!;

          if (!approvedMcpServersRef.current.has(serverName)) {
            const responsePromise = new Promise<ApprovalResponse>(
              (outerResolve) => {
                interactionMutexRef.current = interactionMutexRef.current
                  .then(
                    () =>
                      new Promise<void>((releaseMutex) => {
                        resolveApprovalRef.current = (r) => {
                          outerResolve(r);
                          releaseMutex();
                        };
                        setPendingApproval({
                          key: `mcp:${serverName}`,
                          label: `MCP: ${serverName}`,
                          description:
                            toolCall.toolName.split("__")[1] ??
                            toolCall.toolName,
                          tier: "normal",
                          sessionOnly: true,
                        });
                        ringBellIfUnfocused();
                      }),
                  )
                  .then(() => {
                    setPendingApproval(null);
                    resolveApprovalRef.current = null;
                  });
              },
            );

            const response = await responsePromise;

            if (response.type === "deny") {
              chat.addToolOutput({
                tool: toolCall.toolName as keyof ChatTools,
                toolCallId: toolCall.toolCallId,
                output: {
                  denied: true,
                  reason: "User rejected this MCP action",
                },
              });
              return;
            }

            if (response.type === "allow-for-session") {
              approvedMcpServersRef.current.add(serverName);
            }
          }
        }

        // Permission gate for all other tools.
        const extraPatterns = readProjectConfig().sensitivePatterns ?? [];
        // checks if incoming tool call requires approval
        const permInfo = getPermissionInfo(
          toolCall.toolName,
          toolCall.input,
          extraPatterns,
        );

        // checks if tool requires approval and is not permitted for this project or session
        const isSessionApproved =
          permInfo.requiresApproval &&
          sessionApprovedKeysRef.current.has(permInfo.key);
        if (
          permInfo.requiresApproval &&
          !isSessionApproved &&
          !isPermittedForProject(permInfo.key)
        ) {
          const approval: PendingApproval = {
            key: permInfo.key,
            label: permInfo.label,
            description: permInfo.description,
            tier: permInfo.tier,
            sessionOnly: permInfo.sessionOnly,
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
                      ringBellIfUnfocused();
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

          if (response.type === "allow-for-session") {
            sessionApprovedKeysRef.current.add(permInfo.key);
          } else if (response.type === "allow-for-project") {
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
        const lastModelUsed = String(
          chat.messages.findLast((m) => m.metadata?.model)?.metadata?.model ??
            "",
        );

        try {
          const output = await executeLocalTool(
            toolCall.toolName,
            toolInput,
            _activeModes.get(sessionId)!,
            lastModelUsed,
            sessionId,
          );
          trackToolExecuted({
            tool: toolCall.toolName,
            mode: _activeModes.get(sessionId)!,
            success: true,
          });

          // Backgrounded shell commands (shell.ts registers the task and
          // settles it internally, on proc.exited) still need a default
          // listener wired up here — same "delivers automatically, no polling
          // required" guarantee spawnAgent's runInBackground already has,
          // via the same shared registry (background-tasks.ts).
          if (
            toolCall.toolName === "shell" &&
            output &&
            typeof output === "object" &&
            "pid" in output &&
            !("exitCode" in output)
          ) {
            const taskId = String((output as { pid: number }).pid);
            trackFeatureUsed({ feature: "shell-background" });

            const unsubscribeDefault = onTaskSettled(taskId, (task) => {
              _defaultTaskListeners.delete(taskId);
              const outcome =
                task.status === "completed" ? task.result! : task.error!;
              queueMessage(outcome, "background-task");
            });

            _defaultTaskListeners.set(taskId, unsubscribeDefault);
          }

          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output,
          });
        } catch (error) {
          trackToolExecuted({
            tool: toolCall.toolName,
            mode: _activeModes.get(sessionId)!,
            success: false,
          });
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

  // Live mirror of chat.status for queueMessage (declared above, referencing
  // this ref) — a plain closure-captured chat.status would reflect whatever it
  // was back when the firing callback (a timer, a settle listener) was created,
  // which may be many renders stale; this ref is always read fresh, at the
  // actual moment of firing.
  const chatStatusRef = useRef(chat.status);
  useEffect(() => {
    chatStatusRef.current = chat.status;
  }, [chat.status]);

  // Auto-drain: when the agent finishes, send the next queued message.
  useEffect(() => {
    if (chat.status !== "ready") return;
    const queue = messageQueueRef.current;

    if (queue.length === 0) return;
    const [next, ...rest] = queue;

    setMessageQueue(rest);
    if (next) {
      setWasInterrupted(false);
      void chat.sendMessage({
        text: next.userText,
        metadata: { mode: next.mode, model: next.model, origin: next.origin },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status]);

  // Ring the bell when the agent goes idle with nothing queued to auto-send —
  // i.e. it's genuinely done and waiting on the user, not mid-way through a batch.
  // Guarded by prevStatusRef so this only fires on a streaming/submitted → ready
  // transition, not on mount (e.g. reopening a session that's already "ready").
  const prevStatusRef = useRef(chat.status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = chat.status;

    if (chat.status !== "ready") return;
    if (prevStatus !== "streaming" && prevStatus !== "submitted") return;
    if (messageQueueRef.current.length > 0) return;

    ringBellIfUnfocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status]);

  const contextUsage = useMemo((): ContextUsage | null => {
    const hasAssistantMessages = chat.messages.some(
      (m) => m.role === "assistant",
    );
    if (!hasAssistantMessages) return null;

    const lastWithUsage = [...chat.messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.metadata?.usage);
    if (!lastWithUsage?.metadata?.usage) {
      // Messages exist but the model doesn't report token usage
      return {
        tokensUsed: 0,
        contextWindow: 0,
        percent: 0,
        hasUsageData: false,
      };
    }

    const tokensUsed = lastWithUsage.metadata.usage.inputTokens ?? 0;
    // Capacity reflects the *currently selected* model, not necessarily the model that produced
    // the last response — switching models should update the window immediately, even before the
    // next request goes out. The last message's own contextWindow (server-known, for Ollama/custom
    // models outside the curated list) is only reusable when that message's model is still selected.
    const contextWindow =
      lastWithUsage.metadata.model === currentModel
        ? (lastWithUsage.metadata.contextWindow ??
          getContextWindow(currentModel))
        : getContextWindow(currentModel);

    return {
      tokensUsed,
      contextWindow,
      percent: Math.min(100, Math.round((tokensUsed / contextWindow) * 100)),
      hasUsageData: true,
    };
  }, [chat.messages, currentModel]);

  const sessionCost = useMemo(
    () => estimateSessionCost(chat.messages),
    [chat.messages],
  );

  const resolveApproval = useCallback((response: ApprovalResponse) => {
    resolveApprovalRef.current?.(response);
  }, []);

  const resolveUserQuestion = useCallback((value: string | null) => {
    resolveUserQuestionRef.current?.(value);
  }, []);

  const resolveModeSwitch = useCallback((response: ModeSwitchResponse) => {
    resolveModeSwitchRef.current?.(response);
  }, []);

  const abort = useCallback(() => {
    setMessageQueue([]);
    return chat.stop();
    // chat.stop is stable (provided by useAiChat), so this callback never changes reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    sessionCost,
    addSystemEvent: (text: string) => {
      setSystemEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          text,
          afterMessageCount: chat.messages.length,
        },
      ]);
    },
    messageQueue,
    queueLength: messageQueue.length,
    removeFromQueue: (index: number) => {
      setMessageQueue((prev) => prev.filter((_, i) => i !== index));
    },
    submit: (params: { userText: string; mode: ModeType; model: string }) => {
      clearPendingWakeup(sessionId);
      if (!hasApiKeyForModel(params.model)) {
        toast.show({
          variant: "error",
          message:
            "No API key configured for this model. Run `koincode --openrouter-key <key>` or use /setup.",
        });
        return;
      }
      const queued = chat.status === "submitted" || chat.status === "streaming";
      trackMessageSent({ model: params.model, mode: params.mode, queued });
      if (queued) {
        setMessageQueue((prev) => [...prev, params]);
        return;
      }
      setWasInterrupted(false);
      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
        },
      });
    },
    abort,
    interrupt: () => {
      setWasInterrupted(true);
      chat.stop();
    },
  };
}

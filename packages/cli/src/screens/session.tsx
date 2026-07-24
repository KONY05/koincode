import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { useKeyboard } from "@opentui/react";
import type { InferResponseType } from "hono/client";
import { z } from "zod";

import { modeSchema, BOUNDARY_ROLES, type WorkspaceRoot } from "@koincode/shared";
import { SessionShell } from "../components/session-shell";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
  SystemMessage,
  BackgroundTaskMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import { SessionActionsProvider } from "../providers/session-actions";
import type { Message } from "../hooks/use-chat";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { collectMutations, planRevert, applyRevert } from "../lib/revert-mutations";
import type { PendingRevertConfirm } from "../components/widget/revert-confirm-widget";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;

const initialStateSchema = z.object({
  message: z.string(),
  mode: modeSchema,
  model: z.string(),
});

function ChatMessage({
  msg,
  streaming = false,
  interrupted = false,
  isSubagentRunning = false,
}: {
  msg: Message;
  streaming?: boolean;
  interrupted?: boolean;
  isSubagentRunning?: boolean;
}) {
  if (msg.role === "user") {
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");

    // Background task deliveries are sent as real user turns (required for the
    // model to react to them), but should read as a structured result the
    // agent is being handed rather than something the human typed or more
    // assistant prose. Rendered as a labeled result card when there's a clean
    // single task to show (backgroundTaskView); scheduleWakeup's fired
    // `prompt` doesn't set that (it may mix free-form text with an appended
    // task result), so it falls back to the plain assistant-styled text.
    if (msg.metadata?.origin === "background-task") {
      if (msg.metadata.backgroundTaskView) {
        return (
          <BackgroundTaskMessage
            view={msg.metadata.backgroundTaskView}
            model={msg.metadata?.model ?? "unknown"}
          />
        );
      }

      return (
        <BotMessage
          parts={[{ type: "text", text }]}
          model={msg.metadata?.model ?? "unknown"}
        />
      );
    }

    return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      durationMs={msg.metadata?.durationMs}
      streaming={streaming}
      interrupted={interrupted || msg.metadata?.interrupted}
      isSubagentRunning={isSubagentRunning}
    />
  );
}

/**
 * Returns how many valid AI messages appear before the last boundary marker
 * (clear_boundary or compact_boundary) in the raw session messages array.
 * Used as the slice offset so the transcript only renders post-boundary messages.
 *
 * Returns 0 if no boundary exists.
 */
function countMessagesBeforeLastBoundary(rawMessages: unknown[]): number {
  let lastBoundaryIdx = -1;
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const type = (rawMessages[i] as { type?: string } | null)?.type;
    if (type && BOUNDARY_ROLES.has(type)) {
      lastBoundaryIdx = i;
      break;
    }
  }
  if (lastBoundaryIdx === -1) return 0;
  return rawMessages
    .slice(0, lastBoundaryIdx)
    .filter((m) => !BOUNDARY_ROLES.has((m as { type?: string } | null)?.type ?? ""))
    .length;
}

function SessionChat({
  session,
  initialState,
  onDeleteLastMessage,
  onHandoff,
}: {
  session: SessionData;
  initialState: z.infer<typeof initialStateSchema> | null;
  onDeleteLastMessage?: () => void;
  onHandoff: () => Promise<void>;
}) {
  const rawSessionMessages = session.messages as unknown[];

  const [initialMessages] = useState<Message[]>(() =>
    rawSessionMessages.filter(
      (m): m is Message =>
        m !== null &&
        typeof m === "object" &&
        (m as { type?: string }).type !== "clear_boundary" &&
        (m as { type?: string }).type !== "compact_boundary",
    ),
  );

  const [localClearMsgCount, setLocalClearMsgCount] = useState(() =>
    countMessagesBeforeLastBoundary(rawSessionMessages),
  );
  const { mode, model, reasoningEffort } = usePromptConfig();
  const { isTopLayer } = useKeyboardLayer();
  const toast = useToast();
  const [workspaceRoots, setWorkspaceRoots] = useState<WorkspaceRoot[]>(
    () => session.roots,
  );
  const lastEscapePressRef = useRef<number>(0);
  const hasAutoSubmittedRef = useRef(false);
  const [pendingRevertConfirm, setPendingRevertConfirm] =
    useState<PendingRevertConfirm | null>(null);

  const {
    messages,
    status,
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
    messageQueue,
    removeFromQueue,
    addSystemEvent,
    submit,
    abort,
    interrupt,
    error,
    markInstructionBoundary,
  } = useChat(session.id, initialMessages, [], workspaceRoots, localClearMsgCount);

  // Background-task deliveries (spawnAgent runInBackground, backgrounded
  // shell) share the same underlying queue as real queued user messages —
  // they still need to auto-drain in original arrival order — but shouldn't
  // show up in the visible queue panel/count/keyboard-nav, since they're not
  // something the user is waiting to send; they should just arrive on their
  // own once ready.
  const visibleMessageQueue = messageQueue.filter(
    (m) => m.origin !== "background-task",
  );

  // Stop the pending reply when the user leaves this session.
  useEffect(() => {
    return () => {
      void abort();
    };
  }, [abort]);

  // Auto-submit the first message when navigating from NewSession.
  // initialState is only set on that path; existing sessions have no state.
  // We check initialMessages.length === 0 to ensure we never double-submit.
  useEffect(() => {
    if (hasAutoSubmittedRef.current) return;
    if (!initialState || initialMessages.length !== 0) return;

    hasAutoSubmittedRef.current = true;
    const autoSubmit = async () => {
      try {
        await submit({
          userText: initialState.message,
          mode: initialState.mode,
          model: initialState.model,
        });
      } catch (err) {
        toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Failed to get agent response",
        });
      }
    };
    void autoSubmit();
  }, [initialState, initialMessages, submit, toast]);

  // Deleting the last turn also reverts any writeFile/editFile mutations it made
  // (shell mutations aren't tracked — not safely revertible). If the turn made no
  // such mutations, delete immediately; otherwise confirm first, since revert
  // touches the user's files on disk.
  const initiateDelete = async () => {
    if (!onDeleteLastMessage) return;

    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) {
      onDeleteLastMessage();
      return;
    }

    const mutations = collectMutations(messages.slice(lastUserIndex));
    if (mutations.length === 0) {
      onDeleteLastMessage();
      return;
    }

    const plans = await planRevert(mutations);
    setPendingRevertConfirm({ plans });
  };

  const handleRevertConfirmResponse = async (confirmed: boolean) => {
    setPendingRevertConfirm(null);
    if (!confirmed) return;
    await applyRevert(pendingRevertConfirm?.plans ?? []);
    onDeleteLastMessage?.();
  };

  // Let the user cancel a reply even before the first streamed chunk arrives.
  // Double-tap escape to delete last message when not streaming
  useKeyboard((key) => {
    if (key.name === "escape" && isTopLayer("base")) {
      key.preventDefault();

      const now = Date.now();
      const timeSinceLastPress = now - lastEscapePressRef.current;

      if (status === "streaming" || status === "submitted") {
        // Single press during streaming/submitted: interrupt
        lastEscapePressRef.current = 0;
        interrupt();
      } else if (
        timeSinceLastPress < 500 &&
        (status === "ready" || status === "error") &&
        onDeleteLastMessage
      ) {
        // Double-tap when ready: delete last message
        lastEscapePressRef.current = 0;
        void initiateDelete();
      } else {
        // Single press when ready: just record the time
        lastEscapePressRef.current = now;
      }
    }
  });

  // Build the visible transcript by interleaving AI messages with system events (e.g. mode
  // switch dividers). Messages and events at or before localClearMsgCount are skipped — they
  // predate the last /clear and should not be shown.
  //
  // System events carry an `afterMessageCount` that records how many messages existed when
  // the event fired, which lets us place each divider directly after the message it followed.
  // eventIdx is a forward-only cursor so every event is visited exactly once.
  const transcript = useMemo(() => {
    type Item =
      | { type: "message"; msg: Message; index: number }
      | { type: "system"; id: string; text: string };

    const items: Item[] = [];
    let eventIdx = 0;

    for (let i = 0; i < messages.length; i++) {
      if (i >= localClearMsgCount) {
        items.push({ type: "message", msg: messages[i]!, index: i });
      }
      while (
        eventIdx < systemEvents.length &&
        systemEvents[eventIdx]!.afterMessageCount <= i + 1
      ) {
        if (systemEvents[eventIdx]!.afterMessageCount > localClearMsgCount) {
          items.push({
            type: "system",
            id: systemEvents[eventIdx]!.id,
            text: systemEvents[eventIdx]!.text,
          });
        }
        eventIdx++;
      }
    }
    while (eventIdx < systemEvents.length) {
      if (systemEvents[eventIdx]!.afterMessageCount > localClearMsgCount) {
        items.push({
          type: "system",
          id: systemEvents[eventIdx]!.id,
          text: systemEvents[eventIdx]!.text,
        });
      }
      eventIdx++;
    }

    return items;
  }, [messages, systemEvents, localClearMsgCount]);

  const [isCompacting, setIsCompacting] = useState(false);
  const [isHandingOff, setIsHandingOff] = useState(false);
  const hasAutoCompactedRef = useRef(false);

  const runCompact = async (source: "manual" | "auto") => {
    setIsCompacting(true);

    const label = source === "auto" ? "Context full — auto-compacting…" : "Compacting context…";

    toast.show({ variant: "info", message: label });

    try {
      const res = await apiClient.sessions[":id"].compact.$post({ param: { id: session.id } });

      if (!res.ok) throw new Error("Compact failed");

      markInstructionBoundary();

      const eventText = source === "auto"
        ? "Context auto-compacted — history summarized, context window reset"
        : "Context compacted — history summarized, context window reset";

      addSystemEvent(eventText);

      toast.show({ variant: "success", message: source === "auto" ? "Context auto-compacted" : "Context compacted" });
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Compact failed",
      });
      
      if (source === "auto") hasAutoCompactedRef.current = false;
    } finally {
      setIsCompacting(false);
    }
  };

  // Auto-compact when context is full (≥ 95% — leaves room for the model's final response)
  useEffect(() => {
    if (!contextUsage || contextUsage.percent < 95) {
      hasAutoCompactedRef.current = false;
      return;
    }
    if (hasAutoCompactedRef.current) return;
    if (status === "streaming" || status === "submitted") return;

    hasAutoCompactedRef.current = true;
    // Defer to next tick so setState inside runCompact doesn't fire synchronously within the effect.
    const t = setTimeout(() => void runCompact("auto"), 0);
    return () => clearTimeout(t);
  // runCompact is stable enough not to be listed — adding it would re-trigger on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextUsage, status]);

  const handleInvokeSkill = async (skillName: string) => {
    await submit({ userText: `Execute skill: ${skillName}`, mode, model, reasoningEffort: reasoningEffort ?? undefined });
  };

  const handleClearSession = async () => {
    await apiClient.sessions[":id"].clear.$post({ param: { id: session.id } });
    setLocalClearMsgCount(messages.length);
    markInstructionBoundary();
  };

  const handleAddWorkspaceRoot = async (path: string) => {
    try {
      const res = await apiClient.sessions[":id"]["add-root"].$post({
        param: { id: session.id },
        json: { path },
      });

      if (!res.ok) {
        toast.show({
          variant: "error",
          message: (await getErrorMessage(res)) || "Failed to add directory",
        });
        return;
      }

      const { roots } = await res.json();
      setWorkspaceRoots(roots);

      const added = roots[roots.length - 1];
      toast.show({
        variant: "success",
        message: `Added ${added?.label ?? path} to this workspace`,
      });
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to add directory",
      });
    }
  };

  const handleCompact = () => runCompact("manual");

  const handleHandoffWithLoading = async () => {
    setIsHandingOff(true);
    try {
      await onHandoff();
    } finally {
      setIsHandingOff(false);
    }
  };

  return (
    <SessionActionsProvider
      invokeSkill={handleInvokeSkill}
      clearSession={handleClearSession}
      handoff={handleHandoffWithLoading}
      compact={handleCompact}
      addWorkspaceRoot={handleAddWorkspaceRoot}
      workspaceRoots={workspaceRoots}
    >
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model, reasoningEffort: reasoningEffort ?? undefined })}
      onForceNext={interrupt}
      contextUsage={contextUsage}
      sessionCost={sessionCost}
      sessionTitle={session.title}
      workspaceRoots={workspaceRoots}
      streaming={
        status === "submitted" || status === "streaming" || isSubagentRunning || isCompacting || isHandingOff
      }
      loadingAction={
        isCompacting ? "compacting…" :
        isHandingOff ? "summarizing…" :
        undefined
      }
      interruptible={
        status === "submitted" || status === "streaming" || isSubagentRunning
      }
      queue={visibleMessageQueue}
      onRemoveFromQueue={removeFromQueue}
      pendingApproval={pendingApproval}
      onApprovalResponse={resolveApproval}
      pendingUserQuestion={pendingUserQuestion}
      onUserQuestionResponse={resolveUserQuestion}
      pendingModeSwitch={pendingModeSwitch}
      onModeSwitchResponse={resolveModeSwitch}
      pendingRevertConfirm={pendingRevertConfirm}
      onRevertConfirmResponse={handleRevertConfirmResponse}
      messages={messages}
    >
      {transcript.map((item) => {
        if (item.type === "system") {
          return <SystemMessage key={item.id} text={item.text} />;
        }
        const { msg, index } = item;
        const isLast = index === messages.length - 1;
        const isLastAssistant = isLast && msg.role === "assistant";
        return (
          <ChatMessage
            key={msg.id}
            msg={msg}
            streaming={status === "streaming" && isLastAssistant}
            interrupted={
              wasInterrupted && status !== "streaming" && isLastAssistant
            }
            isSubagentRunning={isSubagentRunning}
          />
        );
      })}
      {error && (
        <ErrorMessage
          message={
            typeof error.message === "string" && error.message
              ? error.message
              : "An error occurred"
          }
        />
      )}
    </SessionShell>
    </SessionActionsProvider>
  );
}

export function Session() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [session, setSession] = useState<SessionData | null>(null);

  const initialState = useMemo(() => {
    const parsed = initialStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  useEffect(() => {
    if (!session?.title) return;
    process.stdout.write(`\x1b]0;${session.title} — koincode\x07`);
    return () => { process.stdout.write(`\x1b]0;koincode\x07`); };
  }, [session?.title]);

  useEffect(() => {
    if (!id) return;

    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[":id"].$get({
          param: { id },
        });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolved = await res.json();
        setSession(resolved);
      } catch (err) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Failed to load session",
        });
        navigate("/", { replace: true });
      }
    };

    fetchSession();
    return () => {
      ignore = true;
    };
  }, [id, toast, navigate]);

  const handleHandoff = async () => {
    if (!session) return;
    toast.show({ variant: "info", message: "Summarizing session…" });
    try {
      const res = await apiClient.sessions[":id"].handoff.$post({
        param: { id: session.id },
      });
      if (!res.ok) throw new Error(await getErrorMessage(res));
      const { sessionId } = await res.json();
      navigate(`/sessions/${sessionId}`);
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Handoff failed",
      });
    }
  };

  const handleDeleteLastMessage = async () => {
    if (!session) return;
    try {
      const res = await apiClient.sessions[":id"].messages["last-user"].$delete(
        {
          param: { id: session.id },
        },
      );
      if (!res.ok) {
        const error = await getErrorMessage(res);
        toast.show({
          variant: "error",
          message: error || "Failed to delete message",
        });
        return;
      }
      // Refetch session to get updated messages
      const updatedRes = await apiClient.sessions[":id"].$get({
        param: { id: session.id },
      });
      if (updatedRes.ok) {
        const updatedSession = await updatedRes.json();
        // Force remount by setting to null then back
        setSession(null);
        setTimeout(() => setSession(updatedSession), 0);
      }
    } catch (err) {
      toast.show({
        variant: "error",
        message:
          err instanceof Error ? err.message : "Failed to delete message",
      });
    }
  };

  if (!session) {
    return <SessionShell onSubmit={() => {}} inputDisabled />;
  }

  return (
    <SessionChat
      key={session.id}
      session={session}
      initialState={initialState}
      onDeleteLastMessage={handleDeleteLastMessage}
      onHandoff={handleHandoff}
    />
  );
}

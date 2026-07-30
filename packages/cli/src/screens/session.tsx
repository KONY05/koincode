import { basename } from "path";
import { useState, useEffect, useMemo, useRef, type RefObject } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { useKeyboard } from "@opentui/react";
import type { InferResponseType } from "hono/client";
import { z } from "zod";

import {
  modeSchema,
  BOUNDARY_ROLES,
  findRootConflict,
  makeRootLabel,
  type WorkspaceRoot,
} from "@koincode/shared";
import { getGitBranch } from "../utils/helper";
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
import type { InlineSystemEvent, Message, SystemEvent } from "../hooks/use-chat";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { collectMutations, planRevert, applyRevert } from "../lib/revert-mutations";
import type { PendingRevertConfirm } from "../components/widget/revert-confirm-widget";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;

const workspaceRootSchema = z.object({ label: z.string(), path: z.string() });

const initialStateSchema = z.object({
  message: z.string(),
  mode: modeSchema,
  model: z.string(),
  pendingRoots: z.array(workspaceRootSchema).optional().default([]),
  isIncognito: z.boolean().optional().default(false),
});

function ChatMessage({
  msg,
  streaming = false,
  interrupted = false,
  isSubagentRunning = false,
  incognito = false,
  inlineEvents = [],
}: {
  msg: Message;
  streaming?: boolean;
  interrupted?: boolean;
  isSubagentRunning?: boolean;
  incognito?: boolean;
  inlineEvents?: InlineSystemEvent[];
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

    return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} incognito={incognito} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      durationMs={msg.metadata?.durationMs}
      streaming={streaming}
      interrupted={interrupted || msg.metadata?.interrupted}
      isSubagentRunning={isSubagentRunning}
      inlineEvents={inlineEvents}
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
  hasAutoSubmittedRef,
  onDeleteLastMessage,
  onHandoff,
  isIncognito = false,
}: {
  session: SessionData;
  initialState: z.infer<typeof initialStateSchema> | null;
  hasAutoSubmittedRef: RefObject<boolean>;
  onDeleteLastMessage?: () => void;
  onHandoff: () => Promise<void>;
  isIncognito?: boolean;
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
    deleteLastUserTurn,
  } = useChat(session.id, initialMessages, [], workspaceRoots, localClearMsgCount, isIncognito);

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
  }, [initialState, initialMessages, submit, toast, hasAutoSubmittedRef]);

  // Deleting the last turn also reverts any writeFile/editFile mutations it made
  // (shell mutations aren't tracked — not safely revertible). If the turn made no
  // such mutations, delete immediately; otherwise confirm first, since revert
  // touches the user's files on disk.
  const initiateDelete = async () => {
    // Incognito: there's no Message row to delete/refetch (see deleteLastUserTurn),
    // so this doesn't go through onDeleteLastMessage at all — only the revert-confirm
    // decision below (mutations found or not) differs from the normal path.
    if (!isIncognito && !onDeleteLastMessage) return;

    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) {
      if (!isIncognito) onDeleteLastMessage?.();
      return;
    }

    const mutations = collectMutations(messages.slice(lastUserIndex));
    if (mutations.length === 0) {
      if (isIncognito) {
        deleteLastUserTurn();
      } else {
        onDeleteLastMessage?.();
      }
      return;
    }

    const plans = await planRevert(mutations);
    setPendingRevertConfirm({ plans });
  };

  const handleRevertConfirmResponse = async (confirmed: boolean) => {
    setPendingRevertConfirm(null);
    if (!confirmed) return;
    await applyRevert(pendingRevertConfirm?.plans ?? []);
    if (isIncognito) {
      deleteLastUserTurn();
    } else {
      onDeleteLastMessage?.();
    }
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
  // Events that fired mid-turn (switchMode) also carry a `partIndex` — the position within
  // that message's own parts array — so they're handed to the message itself and rendered
  // inline between its parts, rather than after the whole (still-growing) message. Events
  // without a partIndex (e.g. /compact, which fires between turns) keep the old standalone
  // divider behavior. eventIdx is a forward-only cursor so every standalone event is visited
  // exactly once.
  const transcript = useMemo(() => {
    type Item =
      | { type: "message"; msg: Message; index: number; inlineEvents: InlineSystemEvent[] }
      | { type: "system"; id: string; text: string };

    const inlineByMessageIndex = new Map<number, InlineSystemEvent[]>();
    const standaloneEvents: SystemEvent[] = [];
    for (const event of systemEvents) {
      if (event.partIndex !== undefined) {
        const targetIndex = event.afterMessageCount - 1;
        const list = inlineByMessageIndex.get(targetIndex) ?? [];
        list.push({ id: event.id, text: event.text, partIndex: event.partIndex });
        inlineByMessageIndex.set(targetIndex, list);
      } else {
        standaloneEvents.push(event);
      }
    }

    const items: Item[] = [];
    let eventIdx = 0;

    for (let i = 0; i < messages.length; i++) {
      if (i >= localClearMsgCount) {
        items.push({
          type: "message",
          msg: messages[i]!,
          index: i,
          inlineEvents: inlineByMessageIndex.get(i) ?? [],
        });
      }
      while (
        eventIdx < standaloneEvents.length &&
        standaloneEvents[eventIdx]!.afterMessageCount <= i + 1
      ) {
        if (standaloneEvents[eventIdx]!.afterMessageCount > localClearMsgCount) {
          items.push({
            type: "system",
            id: standaloneEvents[eventIdx]!.id,
            text: standaloneEvents[eventIdx]!.text,
          });
        }
        eventIdx++;
      }
    }
    while (eventIdx < standaloneEvents.length) {
      if (standaloneEvents[eventIdx]!.afterMessageCount > localClearMsgCount) {
        items.push({
          type: "system",
          id: standaloneEvents[eventIdx]!.id,
          text: standaloneEvents[eventIdx]!.text,
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
    // Not available in incognito v1 — compaction summarizes via a DB-backed endpoint
    // that assumes a real Session row. Auto-compact just skips silently (nothing the
    // user asked for); manual /compact explains why.
    if (isIncognito) {
      if (source === "manual") {
        toast.show({ variant: "info", message: "Compact isn't available in incognito mode yet" });
      }
      return;
    }

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
    // Incognito has no Message rows to fence with a clear_boundary marker — the local
    // transcript-hiding + instruction-boundary reset below is the whole effect anyway.
    if (!isIncognito) {
      await apiClient.sessions[":id"].clear.$post({ param: { id: session.id } });
    }
    setLocalClearMsgCount(messages.length);
    markInstructionBoundary();
  };

  const handleAddWorkspaceRoot = async (path: string) => {
    // Incognito has no Session row to persist `roots` on — mirror Home's own
    // pre-session /add-dir handling (same findRootConflict/makeRootLabel helpers),
    // fully client-side.
    if (isIncognito) {
      const conflict = findRootConflict(path, workspaceRoots);
      if (conflict) {
        toast.show({
          variant: "error",
          message: `"${path}" overlaps with the existing "${conflict.label}" root`,
        });
        return;
      }

      const label = makeRootLabel(path, workspaceRoots);
      const nextRoots = [...workspaceRoots, { label, path }];
      setWorkspaceRoots(nextRoots);
      toast.show({ variant: "success", message: `Added ${label} to this workspace` });
      return;
    }

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
      isIncognitoLocked
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
        const { msg, index, inlineEvents } = item;
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
            incognito={isIncognito}
            inlineEvents={inlineEvents}
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

  // Guards the "auto-submit first message from NewSession" effect below.
  // Declared here (not inside SessionChat) so it survives handleDeleteLastMessage's
  // force-remount of SessionChat — otherwise a fresh ref on remount re-arms the
  // guard, and if the delete leaves the session with zero persisted messages
  // (e.g. an errored turn that got merged into a later one server-side, then
  // that merged row itself deleted), the effect re-fires and silently resubmits
  // the original first message.
  const hasAutoSubmittedRef = useRef(false);

  const initialState = useMemo(() => {
    const parsed = initialStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  const isIncognito = initialState?.isIncognito ?? false;

  // Incognito: no Session row exists (or ever will) for `id` — build the session shape
  // straight from the router state NewSession forwarded, instead of GETting a row that
  // was never created. Everything else in this screen only reads `session`'s shape, so
  // a synthetic object with the same fields is enough for the rest of the tree to work.
  // Computed as the initial state itself (not an effect) since it's pure/synchronous —
  // unlike the real fetchSession below, there's no network round trip to wait on.
  const [session, setSession] = useState<SessionData | null>(() => {
    if (!id || !initialState?.isIncognito) return null;

    const cwd = process.cwd();
    const now = new Date().toISOString();
    return {
      id,
      title: initialState.message.slice(0, 100),
      cwd,
      gitBranch: getGitBranch() ?? null,
      createdAt: now,
      updatedAt: now,
      roots: [{ label: basename(cwd), path: cwd }, ...initialState.pendingRoots],
      messages: [],
    } as SessionData;
  });

  useEffect(() => {
    if (!session?.title) return;
    process.stdout.write(`\x1b]0;${session.title} — koincode\x07`);
    return () => { process.stdout.write(`\x1b]0;koincode\x07`); };
  }, [session?.title]);

  useEffect(() => {
    if (!id || initialState?.isIncognito) return;

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
  }, [id, toast, navigate, initialState]);

  const handleHandoff = async () => {
    if (!session) return;
    if (isIncognito) {
      toast.show({ variant: "info", message: "Handoff isn't available in incognito mode" });
      return;
    }
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
    // Incognito never reaches here — SessionChat's initiateDelete/handleRevertConfirmResponse
    // handle deletion entirely client-side via deleteLastUserTurn for that case.
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
      hasAutoSubmittedRef={hasAutoSubmittedRef}
      onDeleteLastMessage={handleDeleteLastMessage}
      onHandoff={handleHandoff}
      isIncognito={isIncognito}
    />
  );
}

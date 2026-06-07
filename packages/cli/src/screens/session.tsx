import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { useKeyboard } from "@opentui/react";
import type { InferResponseType } from "hono/client";
import { z } from "zod";

import { modeSchema } from "@koincode/shared";
import { SessionShell } from "../components/session-shell";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
  SystemMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../hooks/use-chat";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useKeyboardLayer } from "../providers/keyboard-layer";

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

function SessionChat({
  session,
  initialState,
  onDeleteLastMessage,
  onHandoff,
}: {
  session: SessionData;
  initialState: z.infer<typeof initialStateSchema> | null;
  onDeleteLastMessage?: () => void;
  onHandoff?: () => Promise<void>;
}) {
  const [initialMessages] = useState(
    () => session.messages as unknown as Message[],
  );
  const { mode, model } = usePromptConfig();
  const { isTopLayer } = useKeyboardLayer();
  const toast = useToast();
  const lastEscapePressRef = useRef<number>(0);
  const hasAutoSubmittedRef = useRef(false);

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
    submit,
    abort,
    interrupt,
    error,
  } = useChat(session.id, initialMessages);

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
        onDeleteLastMessage();
      } else {
        // Single press when ready: just record the time
        lastEscapePressRef.current = now;
      }
    }
  });

  // Merge AI messages and system events (e.g. mode switch dividers) into one ordered list.
  //
  // systemEvents are tagged with `afterMessageCount` — how many messages existed when the
  // event fired. eventIdx is a forward-only cursor so each event is placed exactly once.
  //
  // For each message at index i, we insert any events whose afterMessageCount <= i+1,
  // meaning they fired while there were at most i+1 messages, so they belong right after
  // message i. The trailing while handles events that outlast all current messages (fired
  // while the last message was still streaming).
  const transcript = useMemo(() => {
    type Item =
      | { type: "message"; msg: Message; index: number }
      | { type: "system"; id: string; text: string };

    const items: Item[] = [];
    let eventIdx = 0;

    for (let i = 0; i < messages.length; i++) {
      items.push({ type: "message", msg: messages[i]!, index: i });
      while (
        eventIdx < systemEvents.length &&
        systemEvents[eventIdx]!.afterMessageCount <= i + 1
      ) {
        items.push({
          type: "system",
          id: systemEvents[eventIdx]!.id,
          text: systemEvents[eventIdx]!.text,
        });
        eventIdx++;
      }
    }
    while (eventIdx < systemEvents.length) {
      items.push({
        type: "system",
        id: systemEvents[eventIdx]!.id,
        text: systemEvents[eventIdx]!.text,
      });
      eventIdx++;
    }

    return items;
  }, [messages, systemEvents]);

  const handleInvokeSkill = async (skillName: string) => {
    await submit({ userText: `Execute skill: ${skillName}`, mode, model });
  };

  return (
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model })}
      onInvokeSkill={handleInvokeSkill}
      onHandoff={onHandoff}
      loading={
        status === "submitted" || status === "streaming" || isSubagentRunning
      }
      interruptible={
        status === "submitted" || status === "streaming" || isSubagentRunning
      }
      pendingApproval={pendingApproval}
      onApprovalResponse={resolveApproval}
      pendingUserQuestion={pendingUserQuestion}
      onUserQuestionResponse={resolveUserQuestion}
      pendingModeSwitch={pendingModeSwitch}
      onModeSwitchResponse={resolveModeSwitch}
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
      {error && <ErrorMessage message={error.message} />}
    </SessionShell>
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
      navigate(`/session/${sessionId}`);
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
    return <SessionShell onSubmit={() => {}} inputDisabled loading />;
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

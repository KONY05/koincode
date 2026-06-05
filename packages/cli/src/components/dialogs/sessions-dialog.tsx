import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { format } from "date-fns";
import { useNavigate, useLocation } from "react-router";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";
import { DialogSearchList } from "../dialog-search-list";
import type { InferResponseType } from "hono/client";
import { getGitBranch } from "../../utils/helper";

type Session = InferResponseType<(typeof apiClient.sessions)["$get"], 200>[number];

const UNDO_DURATION_MS = 5000;

export const SessionsDialogContent = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const sessionsRef = useRef<Session[]>([]);
  const highlightedRef = useRef<Session | null>(null);
  const pendingDeleteRef = useRef<{
    session: Session;
    index: number;
    timerId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const { close } = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { isTopLayer } = useKeyboardLayer();

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSessionId = location.pathname.startsWith("/sessions/")
    ? location.pathname.split("/sessions/")[1]
    : null;

  useEffect(() => {
    let ignore = false;

    const fetchSessions = async () => {
      try {
        const gitBranch = getGitBranch();
        const res = await apiClient.sessions.$get({
          query: {
            cwd: process.cwd(),
            ...(gitBranch ? { gitBranch } : {}),
          },
        });
        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }

        const data = await res.json();

        if (!ignore) {
          setSessions(data);
          highlightedRef.current = data[0] ?? null;
          setLoading(false);
        }
      } catch (error) {
        if (!ignore) {
          show({
            variant: "error",
            message: error instanceof Error ? error.message : "Failed to fetch sessions",
          });
          close();
        }
      }
    };

    fetchSessions();

    return () => {
      ignore = true;
    };
  }, [close, show]);

  const commitDelete = useCallback(
    async (sessionId: string) => {
      try {
        const res = await apiClient.sessions[":id"].$delete({
          param: { id: sessionId },
        });
        if (!res.ok) {
          show({
            variant: "error",
            message: (await getErrorMessage(res)) || "Failed to delete session",
          });
        }
      } catch {
        show({ variant: "error", message: "Failed to delete session" });
      }
    },
    [show],
  );

  // Commit any in-flight pending delete when the dialog unmounts
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
        void commitDelete(pendingDeleteRef.current.session.id);
        pendingDeleteRef.current = null;
      }
    };
  }, [commitDelete]);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.ctrl && key.name === "d") {
      const target = highlightedRef.current;
      if (!target || target.id === activeSessionId) return;
      key.preventDefault();

      // Flush any existing pending delete before starting a new one
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
        void commitDelete(pendingDeleteRef.current.session.id);
        pendingDeleteRef.current = null;
      }

      const index = sessionsRef.current.findIndex((s) => s.id === target.id);
      if (index === -1) return;

      const timerId = setTimeout(() => {
        pendingDeleteRef.current = null;
        void commitDelete(target.id);
      }, UNDO_DURATION_MS);

      pendingDeleteRef.current = { session: target, index, timerId };
      setSessions((prev) => prev.filter((s) => s.id !== target.id));
      show({ variant: "info", message: "Session deleted — Ctrl+U to undo", duration: UNDO_DURATION_MS });
    }

    if (key.ctrl && key.name === "u" && pendingDeleteRef.current) {
      key.preventDefault();
      const { session, index, timerId } = pendingDeleteRef.current;
      clearTimeout(timerId);
      pendingDeleteRef.current = null;
      setSessions((prev) => {
        const restored = [...prev];
        restored.splice(index, 0, session);
        return restored;
      });
      show({ variant: "success", message: "Session restored" });
    }
  });

  const handleSelect = useCallback(
    (session: Session) => {
      close();
      navigate(`/sessions/${session.id}`);
    },
    [close, navigate],
  );

  const handleHighlight = useCallback((session: Session) => {
    highlightedRef.current = session;
  }, []);

  if (loading) {
    return (
      <box flexDirection="column">
        <text attributes={TextAttributes.DIM}>Loading sessions...</text>
      </box>
    );
  }

  return (
    <DialogSearchList
      items={sessions}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      filterFn={(s, query) => s.title.toLowerCase().includes(query.toLowerCase())}
      renderItem={(session, isSelected) => (
        <>
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {session.title}
          </text>
          <box flexGrow={1} />
          <text
            selectable={false}
            fg={isSelected ? "black" : undefined}
            attributes={TextAttributes.DIM}
          >
            {format(new Date(session.updatedAt), "hh:mm a")}
          </text>
        </>
      )}
      getKey={(s) => s.id}
      placeholder="Search sessions"
      emptyText="No matching sessions"
    />
  );
};

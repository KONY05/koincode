import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { format } from "date-fns";
import { useNavigate, useLocation } from "react-router";
import { useKeyboard } from "@opentui/react";

import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";
import { DialogSearchList } from "../dialog-search-list";
import type { InferResponseType } from "hono/client";
import { getGitBranch } from "../../utils/helper";

type Session = InferResponseType<(typeof apiClient.sessions)["$get"], 200>[number];
type Tab = "project" | "all";

const UNDO_DURATION_MS = 5000;

function shortCwd(cwd: string | null | undefined): string {
  if (!cwd) return "";
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

// The `Session` type is inferred from the *current* server's response, but at runtime a client
// can end up talking to an older/foreign server (e.g. a stale build squatting the shared port)
// whose payload is missing newer fields like `roots` or has a malformed `updatedAt`. The
// version-skew guard in server-manager.ts is the real fix; this keeps the dialog from blanking
// the whole screen (an unguarded `.length` / `new Date(...)` throws mid-render) if one slips
// through anyway.
function rootsCount(session: Session): number {
  return session.roots?.length ?? 0;
}

function safeTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, "hh:mm a");
}

export const SessionsDialogContent = () => {
  const [activeTab, setActiveTab] = useState<Tab>("project");
  const [projectSessions, setProjectSessions] = useState<Session[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [allLoading, setAllLoading] = useState(false);
  const fetchedAllRef = useRef(false);

  const sessionsRef = useRef<Session[]>([]);
  const highlightedRef = useRef<Session | null>(null);
  const pendingDeleteRef = useRef<{
    session: Session;
    index: number;
    tab: Tab;
    timerId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const { close } = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const activeSessionId = location.pathname.startsWith("/sessions/")
    ? location.pathname.split("/sessions/")[1]
    : null;

  const activeSessions = activeTab === "project" ? projectSessions : allSessions;

  useEffect(() => {
    sessionsRef.current = activeSessions;
  }, [activeSessions]);

  // Fetch project sessions on mount
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
          setProjectSessions(data);
          highlightedRef.current = data[0] ?? null;
          setProjectLoading(false);
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
    return () => { ignore = true; };
  }, [close, show]);

  // Fetch all sessions when "all" tab is first opened
  useEffect(() => {
    if (activeTab !== "all" || fetchedAllRef.current) return;
    fetchedAllRef.current = true;
    let ignore = false;

    const fetchAll = async () => {
      setAllLoading(true);
      try {
        const res = await apiClient.sessions.$get({ query: {} });

        if (!res.ok) throw new Error(await getErrorMessage(res));

        const data = await res.json();
        
        if (!ignore) {
          setAllSessions(data);
          highlightedRef.current = data[0] ?? null;
          setAllLoading(false);
        }
      } catch (error) {
        if (!ignore) {
          show({
            variant: "error",
            message: error instanceof Error ? error.message : "Failed to fetch sessions",
          });
          setAllLoading(false);
        }
      }
    };

    fetchAll();
    return () => { ignore = true; };
  }, [activeTab, show]);

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

    if (key.name === "tab") {
      setActiveTab((t) => (t === "project" ? "all" : "project"));
      highlightedRef.current = null;
    }

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

      const tab = activeTab;
      pendingDeleteRef.current = { session: target, index, tab, timerId };

      if (tab === "project") {
        setProjectSessions((prev) => prev.filter((s) => s.id !== target.id));
      } else {
        setAllSessions((prev) => prev.filter((s) => s.id !== target.id));
      }
      show({ variant: "info", message: "Session deleted — Ctrl+U to undo", duration: UNDO_DURATION_MS });
    }

    if (key.ctrl && key.name === "u" && pendingDeleteRef.current) {
      key.preventDefault();
      const { session, index, tab, timerId } = pendingDeleteRef.current;
      clearTimeout(timerId);
      pendingDeleteRef.current = null;

      if (tab === "project") {
        setProjectSessions((prev) => {
          const restored = [...prev];
          restored.splice(index, 0, session);
          return restored;
        });
      } else {
        setAllSessions((prev) => {
          const restored = [...prev];
          restored.splice(index, 0, session);
          return restored;
        });
      }
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

  const isLoading = activeTab === "project" ? projectLoading : allLoading;

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={3} paddingX={1}>
        <text
          selectable={false}
          fg={activeTab === "project" ? colors.primary : colors.dimSeparator}
          attributes={activeTab === "project" ? TextAttributes.BOLD : TextAttributes.DIM}
        >
          {activeTab === "project" ? "▶ " : "  "}Project
        </text>
        <text
          selectable={false}
          fg={activeTab === "all" ? colors.primary : colors.dimSeparator}
          attributes={activeTab === "all" ? TextAttributes.BOLD : TextAttributes.DIM}
        >
          {activeTab === "all" ? "▶ " : "  "}All
        </text>
      </box>

      {isLoading ? (
        <box flexDirection="column" paddingX={1}>
          <text selectable={false} attributes={TextAttributes.DIM}>Loading sessions...</text>
        </box>
      ) : (
        <DialogSearchList
          key={activeTab}
          items={activeSessions}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
          filterFn={(s, query) => {
            const q = query.toLowerCase();
            const titleMatch = (s.title ?? "").toLowerCase().includes(q);
            const workspaceMatch = q === "workspace" && rootsCount(s) > 1;
            return titleMatch || workspaceMatch;
          }}
          renderItem={(session, isSelected) => (
            <>
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {session.title}
              </text>
              {rootsCount(session) > 1 && (
                <text
                  selectable={false}
                  fg={isSelected ? "black" : colors.dimSeparator}
                  attributes={TextAttributes.DIM}
                >
                  {"  "}+{rootsCount(session) - 1} dirs
                </text>
              )}
              <box flexGrow={1} />
              {activeTab === "all" && session.cwd && (
                <text
                  selectable={false}
                  fg={isSelected ? "black" : colors.dimSeparator}
                  attributes={TextAttributes.DIM}
                >
                  {shortCwd(session.cwd)}{"  "}
                </text>
              )}
              <text
                selectable={false}
                fg={isSelected ? "black" : undefined}
                attributes={TextAttributes.DIM}
              >
                {safeTime(session.updatedAt)}
              </text>
            </>
          )}
          getKey={(s) => s.id}
          placeholder="Search sessions"
          emptyText="No matching sessions"
        />
      )}

      <text selectable={false} fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
        Tab · switch tabs
      </text>
    </box>
  );
};

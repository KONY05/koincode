import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { WorkspaceRoot } from "@koincode/shared";

export type SessionActionsContextValue = {
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  compact: () => Promise<void>;
  addWorkspaceRoot: (path: string) => Promise<void>;
  workspaceRoots: WorkspaceRoot[];
  /** True once a session has actually started (SessionChat mounted) — /incognito can no
   * longer apply once this is true, since v1 only decides incognito before the first
   * message. False on Home, where nothing has started yet. */
  isIncognitoLocked?: boolean;
};

const noop = () => Promise.resolve();

const SessionActionsContext = createContext<SessionActionsContextValue>({
  invokeSkill: noop,
  clearSession: noop,
  handoff: noop,
  compact: noop,
  addWorkspaceRoot: noop,
  workspaceRoots: [],
  isIncognitoLocked: false,
});

type SessionActionsProviderProps = {
  children: ReactNode;
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  compact: () => Promise<void>;
  addWorkspaceRoot: (path: string) => Promise<void>;
  workspaceRoots: WorkspaceRoot[];
  isIncognitoLocked?: boolean;
};

export function SessionActionsProvider({
  children,
  invokeSkill,
  clearSession,
  handoff,
  compact,
  addWorkspaceRoot,
  workspaceRoots,
  isIncognitoLocked = false,
}: SessionActionsProviderProps) {
  const value = useMemo(
    () => ({ invokeSkill, clearSession, handoff, compact, addWorkspaceRoot, workspaceRoots, isIncognitoLocked }),
    [invokeSkill, clearSession, handoff, compact, addWorkspaceRoot, workspaceRoots, isIncognitoLocked],
  );

  return (
    <SessionActionsContext.Provider value={value}>
      {children}
    </SessionActionsContext.Provider>
  );
}

export function useSessionActions(): SessionActionsContextValue {
    const value = useContext(SessionActionsContext);
    if (!value) {
      throw new Error(
        "useSessionActions must be used within a SessionActionsProvider",
      );
    }
    return value;
}

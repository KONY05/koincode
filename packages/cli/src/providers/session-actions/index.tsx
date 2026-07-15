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
};

const noop = () => Promise.resolve();

const SessionActionsContext = createContext<SessionActionsContextValue>({
  invokeSkill: noop,
  clearSession: noop,
  handoff: noop,
  compact: noop,
  addWorkspaceRoot: noop,
  workspaceRoots: [],
});

type SessionActionsProviderProps = {
  children: ReactNode;
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  compact: () => Promise<void>;
  addWorkspaceRoot: (path: string) => Promise<void>;
  workspaceRoots: WorkspaceRoot[];
};

export function SessionActionsProvider({
  children,
  invokeSkill,
  clearSession,
  handoff,
  compact,
  addWorkspaceRoot,
  workspaceRoots,
}: SessionActionsProviderProps) {
  const value = useMemo(
    () => ({ invokeSkill, clearSession, handoff, compact, addWorkspaceRoot, workspaceRoots }),
    [invokeSkill, clearSession, handoff, compact, addWorkspaceRoot, workspaceRoots],
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
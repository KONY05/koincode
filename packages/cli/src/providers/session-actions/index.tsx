import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export type SessionActionsContextValue = {
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  compact: () => Promise<void>;
};

const noop = () => Promise.resolve();

const SessionActionsContext = createContext<SessionActionsContextValue>({
  invokeSkill: noop,
  clearSession: noop,
  handoff: noop,
  compact: noop,
});

type SessionActionsProviderProps = {
  children: ReactNode;
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  compact: () => Promise<void>;
};

export function SessionActionsProvider({
  children,
  invokeSkill,
  clearSession,
  handoff,
  compact,
}: SessionActionsProviderProps) {
  const value = useMemo(
    () => ({ invokeSkill, clearSession, handoff, compact }),
    [invokeSkill, clearSession, handoff, compact],
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
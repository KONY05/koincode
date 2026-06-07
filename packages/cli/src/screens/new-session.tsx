import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { useNavigate, useLocation } from "react-router";

import { modeSchema } from "@koincode/shared";
import { SessionShell } from "../components/session-shell";
import { UserMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { getGitBranch } from "../utils/helper";

const newSessionStateSchema = z.object({
  message: z.string(),
  mode: modeSchema,
  model: z.string(),
});

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const hasStartedRef = useRef(false);

  const state = useMemo(() => {
    const parsed = newSessionStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  // Guard: if navigated here directly without state, go home
  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  // Create the session on mount — this screen exists to do this
  useEffect(() => {
    if (!state || hasStartedRef.current) return;

    hasStartedRef.current = true;

    let ignore = false;
    const createSession = async () => {
      try {
        const gitBranch = getGitBranch();

        const res = await apiClient.sessions.$post({
          json: {
            title: state.message.slice(0, 100),
            cwd: process.cwd(),
            model: state.model,
            ...(gitBranch ? { gitBranch } : {}),
          },
        });

        if (ignore) return;
        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }
        const session = await res.json();
        navigate(`/sessions/${session.id}`, { state, replace: true });
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            error instanceof Error ? error.message : "Failed to create session",
        });
        navigate("/", { replace: true });
      }
    };

    createSession();
    return () => {
      ignore = true;
    };
  }, [state, navigate, toast, hasStartedRef]);

  if (!state) return null;

  return (
    <SessionShell onSubmit={() => {}} inputDisabled>
      <UserMessage message={state.message} mode={state.mode} />
    </SessionShell>
  );
}

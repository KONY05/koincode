import { useCallback } from "react";
import { useNavigate } from "react-router";
import { TextAttributes } from "@opentui/core";

import { Header } from "../components/header";
import { InputBar } from "../components/input-bar";
import { usePromptConfig } from "../providers/prompt-config";
import { useTheme } from "../providers/theme";
import { SessionActionsProvider } from "../providers/session-actions";
import { CWD, getGitBranch } from "../utils/helper";
import { version } from "../../package.json";


const GIT_BRANCH = getGitBranch();

export function Home() {
  const navigate = useNavigate();
  const { mode, model } = usePromptConfig();
  const { colors } = useTheme();

  const handleSubmit = useCallback(
    (text: string) => {
      navigate("/sessions/new", { state: { message: text, mode, model } });
    },
    [navigate, mode, model],
  );

  const handleInvokeSkill = useCallback(
    async (skillName: string) => {
      navigate("/sessions/new", { state: { message: `Execute skill: ${skillName}`, mode, model } });
    },
    [navigate, mode, model],
  );

  const noop = useCallback(() => Promise.resolve(), []);

  return (
    <SessionActionsProvider
      invokeSkill={handleInvokeSkill}
      clearSession={noop}
      handoff={noop}
      compact={noop}
    >
      <box
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
        gap={2}
        position="relative"
        width="100%"
        height="100%"
      >
        <Header />
        <box width="100%" maxWidth={78} paddingX={2} flexDirection="column" gap={1}>
          <InputBar onSubmit={handleSubmit} />
          <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
            <text>tab</text>
            <text attributes={TextAttributes.DIM}>agents</text>
          </box>
        </box>
        <box position="absolute" bottom={1} left={0} width="100%" paddingX={1} flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            {CWD}{GIT_BRANCH ? `:${GIT_BRANCH}` : ""}
          </text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            v{version}
          </text>
        </box>
      </box>
    </SessionActionsProvider>
  );
};

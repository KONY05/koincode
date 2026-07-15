import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { TextAttributes } from "@opentui/core";
import { basename } from "path";
import { findRootConflict, makeRootLabel, type WorkspaceRoot } from "@koincode/shared";

import { Header } from "../components/header";
import { InputBar } from "../components/input-bar";
import { usePromptConfig } from "../providers/prompt-config";
import { useTheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import { SessionActionsProvider } from "../providers/session-actions";
import { CWD, getGitBranch } from "../utils/helper";
import { hasApiKeyForModel } from "../lib/usage";
import { version } from "../../package.json";
import { useUpdateCheck } from "../hooks/use-update-check";

const GIT_BRANCH = getGitBranch();
// process.cwd() (not the display-shortened CWD from utils/helper) — this needs to be
// a real filesystem path, since it's compared against candidate directories below.
const PRIMARY_ROOT: WorkspaceRoot = { label: basename(process.cwd()), path: process.cwd() };

const NO_API_KEY_MESSAGE =
  "No API key configured for this model. Run `koincode --openrouter-key <key>` or use /setup.";

export function Home() {
  const navigate = useNavigate();
  const { mode, model } = usePromptConfig();
  const { colors } = useTheme();
  const toast = useToast();
  const updateInfo = useUpdateCheck();

  // Staged directories, added via /add-dir before a session exists yet — submitted
  // together with the first message so a session can start as a workspace already
  // spanning multiple roots, instead of always starting single-root and needing
  // /add-dir again afterward.
  const [pendingRoots, setPendingRoots] = useState<WorkspaceRoot[]>([]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!hasApiKeyForModel(model)) {
        toast.show({ variant: "error", message: NO_API_KEY_MESSAGE });
        return;
      }
      navigate("/sessions/new", { state: { message: text, mode, model, pendingRoots } });
    },
    [navigate, mode, model, toast, pendingRoots],
  );

  const handleInvokeSkill = useCallback(
    async (skillName: string) => {
      if (!hasApiKeyForModel(model)) {
        toast.show({ variant: "error", message: NO_API_KEY_MESSAGE });
        return;
      }
      navigate("/sessions/new", {
        state: { message: `Execute skill: ${skillName}`, mode, model, pendingRoots },
      });
    },
    [navigate, mode, model, toast, pendingRoots],
  );

  const noop = useCallback(() => Promise.resolve(), []);

  const handleAddWorkspaceRoot = useCallback(
    async (path: string) => {
      const existingRoots = [PRIMARY_ROOT, ...pendingRoots];
      const conflict = findRootConflict(path, existingRoots);
      if (conflict) {
        toast.show({
          variant: "error",
          message: `"${path}" overlaps with the existing "${conflict.label}" root`,
        });
        return;
      }

      const label = makeRootLabel(path, existingRoots);
      setPendingRoots((prev) => [...prev, { label, path }]);
      toast.show({ variant: "success", message: `Added ${label} to this workspace` });
    },
    [pendingRoots, toast],
  );

  return (
    <SessionActionsProvider
      invokeSkill={handleInvokeSkill}
      clearSession={noop}
      handoff={noop}
      compact={noop}
      addWorkspaceRoot={handleAddWorkspaceRoot}
      workspaceRoots={[PRIMARY_ROOT, ...pendingRoots]}
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
            {pendingRoots.length > 0
              ? ` +${pendingRoots.length} dir${pendingRoots.length > 1 ? "s" : ""}`
              : ""}
          </text>
          <box flexDirection="row" gap={1}>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>v{version}</text>
            {updateInfo.status === "available" && <text fg={colors.primary}>new version available!</text>}
            {updateInfo.status === "downloading" && <text fg={colors.primary}>downloading update...</text>}
            {updateInfo.status === "downloaded" && <text fg={colors.primary}>restart to use v{updateInfo.version}</text>}
            {updateInfo.status === "permission-denied" && <text fg={colors.primary}>update available — run: sudo koincode --update</text>}
          </box>
        </box>
      </box>
    </SessionActionsProvider>
  );
};

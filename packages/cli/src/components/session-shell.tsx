import {
  MacOSScrollAccel,
  TextAttributes,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import React from "react";

import { InputBar } from "./input-bar";
import { QueuePanel } from "./queue-panel";
import { ApprovalWidget } from "./widget/approval-widget";
import { AskUserWidget } from "./widget/ask-user-widget";
import { ModeSwitchWidget } from "./widget/mode-switch-widget";
import { type PendingRevertConfirm, RevertConfirmWidget } from "./widget/revert-confirm-widget";
import { InfoSidebar } from "./info-sidebar";
import type {
  PendingModeSwitch,
  ModeSwitchResponse,
} from "./widget/mode-switch-widget";
import type { ApprovalResponse, PendingApproval } from "../utils/permissions";
import type {
  PendingUserQuestion,
  ContextUsage,
  QueuedMessage,
  Message,
} from "../hooks/use-chat";
import { CWD, getGitBranch } from "../utils/helper";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import type { WorkspaceRoot } from "@koincode/shared";

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  onForceNext?: () => void;
  contextUsage?: ContextUsage | null;
  inputDisabled?: boolean;
  streaming?: boolean;
  loadingAction?: string;
  interruptible?: boolean;
  queue?: QueuedMessage[];
  onRemoveFromQueue?: (id: string) => void;
  pendingApproval?: PendingApproval | null;
  onApprovalResponse?: (response: ApprovalResponse) => void;
  pendingUserQuestion?: PendingUserQuestion | null;
  onUserQuestionResponse?: (value: string | null) => void;
  pendingModeSwitch?: PendingModeSwitch | null;
  onModeSwitchResponse?: (response: ModeSwitchResponse) => void;
  pendingRevertConfirm?: PendingRevertConfirm | null;
  onRevertConfirmResponse?: (confirmed: boolean) => void;
  sessionTitle?: string;
  sessionCost?: number;
  messages?: Message[];
  workspaceRoots?: WorkspaceRoot[];
};

const GIT_BRANCH = getGitBranch();

export function SessionShell({
  children,
  onSubmit,
  onForceNext,
  contextUsage,
  inputDisabled = false,
  streaming = false,
  loadingAction,
  interruptible = false,
  queue = [],
  onRemoveFromQueue,
  pendingApproval = null,
  onApprovalResponse,
  pendingUserQuestion = null,
  onUserQuestionResponse,
  pendingModeSwitch = null,
  onModeSwitchResponse,
  pendingRevertConfirm = null,
  onRevertConfirmResponse,
  sessionTitle,
  sessionCost = 0,
  messages = [],
  workspaceRoots = [],
}: Props) {
  const scrollAccel = useMemo(() => new MacOSScrollAccel(), []);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const prevChildrenCountRef = useRef(0);
  const [queueFocusedIndex, setQueueFocusedIndex] = useState<number | null>(
    null,
  );
  const { colors } = useTheme();
  const { infoSidebarVisible } = usePromptConfig();

  // Clear queue focus when the queue empties.
  useEffect(() => {
    if (queue.length === 0) {
      setTimeout(() => setQueueFocusedIndex(null), 0);
    }
  }, [queue.length]);

  // Auto-scroll to bottom only when a new message is added
  useEffect(() => {
    const currentCount = React.Children.count(children);
    const prevCount = prevChildrenCountRef.current;

    if (currentCount > prevCount) {
      const scrollbox = scrollRef.current;
      if (scrollbox) {
        scrollbox.scrollTo(scrollbox.content.height);
      }
    }

    prevChildrenCountRef.current = currentCount;
  }, [children]);

  const queueLength = queue.length;

  return (
    <box flexDirection="row" width="100%" height="100%">
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      height="100%"
      paddingY={1}
      paddingX={2}
      gap={1}
    >
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        width="100%"
        stickyScroll
        stickyStart="bottom"
        scrollAcceleration={scrollAccel}
      >
        <box>{children}</box>
      </scrollbox>
      <box flexShrink={0}>
        {pendingApproval && onApprovalResponse ? (
          <ApprovalWidget
            approval={pendingApproval}
            onResponse={onApprovalResponse}
          />
        ) : pendingRevertConfirm && onRevertConfirmResponse ? (
          <RevertConfirmWidget
            pending={pendingRevertConfirm}
            onResponse={onRevertConfirmResponse}
          />
        ) : pendingModeSwitch && onModeSwitchResponse ? (
          <ModeSwitchWidget
            pending={pendingModeSwitch}
            onResponse={onModeSwitchResponse}
          />
        ) : pendingUserQuestion && onUserQuestionResponse ? (
          <AskUserWidget
            question={pendingUserQuestion}
            onResponse={onUserQuestionResponse}
          />
        ) : (
          <box flexDirection="column" width="100%">
            {queue.length > 0 && (
              <QueuePanel queue={queue} focusedIndex={queueFocusedIndex} />
            )}
            <InputBar
              onSubmit={onSubmit}
              onForceNext={onForceNext}
              contextUsage={contextUsage}
              disabled={inputDisabled}
              streaming={streaming}
              queue={queue}
              onRemoveFromQueue={onRemoveFromQueue}
              queueFocusedIndex={queueFocusedIndex}
              onQueueFocusedIndexChange={setQueueFocusedIndex}
              messages={messages}
            />
          </box>
        )}
      </box>
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        gap={2}
        paddingLeft={1}
      >
        <box flexDirection="row" alignItems="center" gap={2}>
          {streaming && interruptible ? (
            queueLength > 0 ? (
              <text>
                {queueLength} queued · enter to skip · esc to interrupt
              </text>
            ) : (
              <text>esc to interrupt</text>
            )
          ) : streaming ? (
            <text attributes={TextAttributes.DIM}>
              {loadingAction ?? "working…"}
            </text>
          ) : null}
        </box>

        <box flexDirection="column" gap={0} flexShrink={0} alignItems="flex-end">
          <box flexDirection="row" gap={2} flexShrink={0}>
            <box flexDirection="row" gap={1}>
              <text>opt+enter</text>
              <text attributes={TextAttributes.DIM}>newline</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text>ctrl+c</text>
              <text attributes={TextAttributes.DIM}>copy</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text>ctrl+z</text>
              <text attributes={TextAttributes.DIM}>undo</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text>tab</text>
              <text attributes={TextAttributes.DIM}>agents</text>
            </box>
          </box>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            {CWD}
            {GIT_BRANCH ? `:${GIT_BRANCH}` : ""}
            {workspaceRoots.length > 1
              ? ` +${workspaceRoots.length - 1} dir${workspaceRoots.length > 2 ? "s" : ""}`
              : ""}
          </text>
        </box>
      </box>
    </box>
    <InfoSidebar
      visible={infoSidebarVisible}
      sessionTitle={sessionTitle}
      contextUsage={contextUsage}
      sessionCost={sessionCost}
      workspaceRoots={workspaceRoots}
    />
    </box>
  );
}

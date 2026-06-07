import {
  MacOSScrollAccel,
  TextAttributes,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import React from "react";

import { InputBar } from "./input-bar";
import { ApprovalWidget } from "./widget/approval-widget";
import { AskUserWidget } from "./widget/ask-user-widget";
import { ModeSwitchWidget } from "./widget/mode-switch-widget";
import type {
  PendingModeSwitch,
  ModeSwitchResponse,
} from "./widget/mode-switch-widget";
import type { ApprovalResponse, PendingApproval } from "../utils/permissions";
import type { PendingUserQuestion, ContextUsage } from "../hooks/use-chat";

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  onInvokeSkill?: (skillName: string) => Promise<void>;
  onClearSession?: () => Promise<void>;
  onHandoff?: () => Promise<void>;
  onCompact?: () => Promise<void>;
  contextUsage?: ContextUsage | null;
  inputDisabled?: boolean;
  loading?: boolean;
  interruptible?: boolean;
  pendingApproval?: PendingApproval | null;
  onApprovalResponse?: (response: ApprovalResponse) => void;
  pendingUserQuestion?: PendingUserQuestion | null;
  onUserQuestionResponse?: (value: string | null) => void;
  pendingModeSwitch?: PendingModeSwitch | null;
  onModeSwitchResponse?: (response: ModeSwitchResponse) => void;
};

export function SessionShell({
  children,
  onSubmit,
  onInvokeSkill,
  onClearSession,
  onHandoff,
  onCompact,
  contextUsage,
  inputDisabled = false,
  loading = false,
  interruptible = false,
  pendingApproval = null,
  onApprovalResponse,
  pendingUserQuestion = null,
  onUserQuestionResponse,
  pendingModeSwitch = null,
  onModeSwitchResponse,
}: Props) {
  const scrollAccel = useMemo(() => new MacOSScrollAccel(), []);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const prevChildrenCountRef = useRef(0);

  // Auto-scroll to bottom only when a new message is added
  useEffect(() => {
    const currentCount = React.Children.count(children);
    const prevCount = prevChildrenCountRef.current;

    // Only scroll if the number of children increased (new message added)
    if (currentCount > prevCount) {
      const scrollbox = scrollRef.current;
      if (scrollbox) {
        scrollbox.scrollTo(scrollbox.content.height);
      }
    }

    prevChildrenCountRef.current = currentCount;
  }, [children]);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
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
          <InputBar
            onSubmit={onSubmit}
            onInvokeSkill={onInvokeSkill}
            onClearSession={onClearSession}
            onHandoff={onHandoff}
            onCompact={onCompact}
            contextUsage={contextUsage}
            disabled={inputDisabled || loading}
          />
        )}
      </box>
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        height={1}
        gap={2}
        paddingLeft={1}
      >
        <box flexDirection="row" alignItems="center" gap={2}>
          {loading && interruptible ? <text>esc to interrupt</text> : null}
        </box>

        <box flexDirection="row" gap={2} flexShrink={0} marginLeft="auto">
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
      </box>
    </box>
  );
}

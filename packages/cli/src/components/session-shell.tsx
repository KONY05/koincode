import {
  MacOSScrollAccel,
  TextAttributes,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import React from "react";

import { InputBar } from "./input-bar";
import { QueuePanel } from "./queue-panel";
import { ApprovalWidget } from "./widget/approval-widget";
import { AskUserWidget } from "./widget/ask-user-widget";
import { ModeSwitchWidget } from "./widget/mode-switch-widget";
import type {
  PendingModeSwitch,
  ModeSwitchResponse,
} from "./widget/mode-switch-widget";
import type { ApprovalResponse, PendingApproval } from "../utils/permissions";
import type { PendingUserQuestion, ContextUsage, QueuedMessage } from "../hooks/use-chat";
import { useKeyboardLayer } from "../providers/keyboard-layer";

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  onForceNext?: () => void;
  contextUsage?: ContextUsage | null;
  mcpServerCount?: number;
  inputDisabled?: boolean;
  streaming?: boolean;
  loadingAction?: string;
  interruptible?: boolean;
  queue?: QueuedMessage[];
  onRemoveFromQueue?: (index: number) => void;
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
  onForceNext,
  contextUsage,
  mcpServerCount,
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
}: Props) {
  const scrollAccel = useMemo(() => new MacOSScrollAccel(), []);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const prevChildrenCountRef = useRef(0);
  const { push, pop } = useKeyboardLayer();

  const [queueFocusedIndex, setQueueFocusedIndex] = useState<number | null>(null);

  // Clamp to valid bounds during render; stale state after auto-drain is fine
  // because QueuePanel is hidden when queue is empty and enterQueueFocus resets it.
  // So when queue.length === 0, effectiveFocusedIndex is always null regardless of what stale value is sitting in queueFocusedIndex. The QueuePanel never sees the stale index.
  // null = not in queue focus mode. A number = focused on that index.
  const effectiveFocusedIndex: number | null =
    queueFocusedIndex === null || queue.length === 0
      ? null
      : Math.min(queueFocusedIndex, queue.length - 1);

  // Pop the keyboard layer when auto-drain empties the queue while focused.
  // setState is intentionally absent — effectiveFocusedIndex handles the null
  // case during render; the stale state value is reset by enterQueueFocus later.
  useEffect(() => {
    if (queueFocusedIndex !== null && queue.length === 0) {
      pop("queue");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length]);

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


  const exitQueueFocus = useCallback(() => {
    setQueueFocusedIndex(null);
    pop("queue");
  }, [pop]);

  const enterQueueFocus = useCallback(() => {
    if (queue.length === 0) return;
    setQueueFocusedIndex(queue.length - 1); // focus bottom item (nearest input)
    push("queue", () => {
      setQueueFocusedIndex(null);
      return true;
    });
  }, [queue.length, push]);

  const handleRemoveFromQueue = useCallback((index: number) => {
    onRemoveFromQueue?.(index);
    const newLength = queue.length - 1;
    if (newLength === 0) {
      exitQueueFocus();
    } else {
      setQueueFocusedIndex(Math.min(index, newLength - 1));
    }
  }, [queue.length, onRemoveFromQueue, exitQueueFocus]);

  const queueLength = queue.length;

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
          <>
            {queueLength > 0 && (
              <QueuePanel
                queue={queue}
                focusedIndex={effectiveFocusedIndex}
                onFocusChange={setQueueFocusedIndex}
                onRemove={handleRemoveFromQueue}
                exitQueueFocus={exitQueueFocus}
              />
            )}
            <InputBar
              onSubmit={onSubmit}
              onForceNext={onForceNext}
              onEnterQueueFocus={queueLength > 0 ? enterQueueFocus : undefined}
              contextUsage={contextUsage}
              mcpServerCount={mcpServerCount}
              disabled={inputDisabled}
              streaming={streaming}
              queueLength={queueLength}
            />
          </>
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
          {streaming && interruptible ? (
            queueLength > 0 ? (
              <text>{queueLength} queued · enter to skip · esc to interrupt</text>
            ) : (
              <text>esc to interrupt</text>
            )
          ) : streaming ? (
            <text attributes={TextAttributes.DIM}>{loadingAction ?? "working…"}</text>
          ) : null}
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

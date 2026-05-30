import { MacOSScrollAccel, TextAttributes } from "@opentui/core";
import { useMemo, type ReactNode } from "react";

import { InputBar } from "./input-bar";
import { ApprovalWidget } from "./approval-widget";
import { AskUserWidget } from "./ask-user-widget";
import { Spinner } from "./spinner";
import { usePromptConfig } from "../providers/prompt-config";
import type { ApprovalResponse, PendingApproval } from "../lib/permissions";
import type { PendingUserQuestion } from "../hooks/use-chat";

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  inputDisabled?: boolean;
  loading?: boolean;
  interruptible?: boolean;
  pendingApproval?: PendingApproval | null;
  onApprovalResponse?: (response: ApprovalResponse) => void;
  pendingUserQuestion?: PendingUserQuestion | null;
  onUserQuestionResponse?: (value: string | null) => void;
};

export function SessionShell({
  children,
  onSubmit,
  inputDisabled = false,
  loading = false,
  interruptible = false,
  pendingApproval = null,
  onApprovalResponse,
  pendingUserQuestion = null,
  onUserQuestionResponse,
}: Props) {
  const { mode } = usePromptConfig();
  const scrollAccel = useMemo(() => new MacOSScrollAccel(), []);

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
      <scrollbox flexGrow={1} width="100%" stickyScroll stickyStart="bottom" scrollAcceleration={scrollAccel}>
        <box>{children}</box>
      </scrollbox>
      <box flexShrink={0}>
        {pendingApproval && onApprovalResponse ? (
          <ApprovalWidget approval={pendingApproval} onResponse={onApprovalResponse} />
        ) : pendingUserQuestion && onUserQuestionResponse ? (
          <AskUserWidget question={pendingUserQuestion} onResponse={onUserQuestionResponse} />
        ) : (
          <InputBar onSubmit={onSubmit} disabled={inputDisabled} />
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
          {loading ? (
            <>
              <Spinner mode={mode} />
              {interruptible ? <text>esc to interrupt</text> : null}
            </>
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
};

import { useCallback, useMemo } from "react";
import prettyMs from "pretty-ms";
import { getTreeSitterClient, TextAttributes } from "@opentui/core";

import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import type { Message } from "../../hooks/use-chat";
import { Mode, type ModeType } from "@koincode/shared";
import { createMarkdownSyntaxStyle } from "../../utils/syntax-style";
import EditFileDiff from "../tool-view/edit-file";
import WriteFilePreview from "../tool-view/write-file";
import TodoList from "../tool-view/todo-list";
import { Spinner } from "../spinner";

const treeSitterClient = getTreeSitterClient();

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<ClientMessagePart, { type: `tool-${string}` | "dynamic-tool" }>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  streaming?: boolean;
  interrupted?: boolean;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
};

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
};

function formatToolArgs(tc: ToolPart): string {
  if (!("input" in tc) || tc.input == null) return "";
  if (typeof tc.input !== "object") return String(tc.input);
  return Object.values(tc.input).map(String).join(" ");
}

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

     if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
     } else {
      const key = 
        isToolPart(part) ? `group-tc-${part.toolCallId}` : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
     }
  }

  return groups;
};

export function BotMessage({
  parts,
  model,
  mode,
  durationMs,
  streaming = false,
  interrupted = false,
}: Props) {
  const { colors } = useTheme();

  const syntaxStyle = useMemo(() => createMarkdownSyntaxStyle(colors), [colors]);

  const renderCodeBlock = useCallback(
    (token: { type: string }, ctx: { defaultRender: () => { bg?: string } | null }) => {
      if (token.type !== "code") return undefined;
      const renderable = ctx.defaultRender();
      if (renderable) renderable.bg = "#313131ff";
      return renderable;
    },
    []
  );

  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if (part.type === "reasoning") {
              return (
                <box
                  key={`reasoning-${j}`}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em> {part.text}
                  </text>
                </box>
              );
            }

            if (isToolPart(part)) {
              const toolName =
                part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
              const pending = part.state !== "output-available" && part.state !== "output-error";
              const hasInput = "input" in part && part.input != null && part.state !== "input-streaming";

              const errorText = part.state === "output-error" ? part.errorText : undefined;

              return (
                <box
                  key={part.toolCallId}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  {hasInput && toolName === "editFile" ? (
                    <EditFileDiff input={part.input} pending={pending} error={errorText} colors={colors} syntaxStyle={syntaxStyle} treeSitterClient={treeSitterClient}/>
                  ) : hasInput && toolName === "writeFile" ? (
                    <WriteFilePreview input={part.input} pending={pending} error={errorText} colors={colors} />
                  ) : hasInput && (toolName === "createTodos" || toolName === "updateTodos") ? (
                    <TodoList input={part.input} toolName={toolName} pending={pending} colors={colors} />
                  ) : hasInput && toolName === "spawnAgent" ? (
                    <text attributes={TextAttributes.DIM}>
                      <em fg={colors.info}>Subagent:</em>{" "}
                      {(part.input as { name?: string; description?: string }).name ?? ""}{" "}
                      —{" "}
                      {(part.input as { name?: string; description?: string }).description ?? ""}
                      {pending ? " …" : ""}
                      {errorText ? ` ${errorText}` : ""}
                    </text>
                  ) : (
                    <text attributes={TextAttributes.DIM}>
                      <em fg={colors.info}>{formatToolName(toolName)}:</em> {formatToolArgs(part)}
                      {pending ? " …" : ""}
                      {errorText ? ` ${errorText}` : ""}
                    </text>
                  )}
                </box>
              );
            }

            if (part.type === "text") {
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <markdown
                    content={part.text}
                    syntaxStyle={syntaxStyle}
                    treeSitterClient={treeSitterClient}
                    renderNode={renderCodeBlock as never}
                    streaming={streaming}
                    conceal
                    width="100%"
                  />
                </box>
              );
            }
            
            return null;
          })}
        </box>
      ))}

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          {streaming ? (
            <Spinner activeColor={mode === Mode.PLAN ? colors.planMode : colors.primary} />
          ): <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>◉</text>}
          <box flexDirection="row" gap={1}>
            <text>
              {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {(durationMs != null) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {prettyMs(durationMs)}
                </text>
              </>
            )}
            {interrupted && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text fg={colors.error}>agent interrupted</text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
};

import { useCallback, useMemo } from "react";
import prettyMs from "pretty-ms";
import { getTreeSitterClient, TextAttributes } from "@opentui/core";

import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import { usePromptConfig } from "../../providers/prompt-config";
import type { Message } from "../../hooks/use-chat";
import { Mode } from "@koincode/shared";
import { createMarkdownSyntaxStyle } from "../../utils/syntax-style";
import EditFileDiff from "../tool-view/edit-file";
import WriteFilePreview from "../tool-view/write-file";
import TodoList from "../tool-view/todo-list";
import ShellView from "../tool-view/shell";
import McpToolView, { isMcpTool } from "../tool-view/mcp-tool";
import { Spinner } from "../spinner";

const treeSitterClient = getTreeSitterClient();

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<
  ClientMessagePart,
  { type: `tool-${string}` | "dynamic-tool" }
>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  durationMs?: number;
  streaming?: boolean;
  interrupted?: boolean;
  isSubagentRunning?: boolean;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function formatToolArgs(input: unknown): string {
  if (input == null) return "";
  if (typeof input !== "object") return String(input);
  return Object.values(input).map(String).join(" ");
}

type RenderToolContentProps = {
  toolName: string;
  input: unknown;
  output: unknown;
  pending: boolean;
  errorText: string | undefined;
  colors: ReturnType<typeof useTheme>["colors"];
  syntaxStyle: ReturnType<typeof createMarkdownSyntaxStyle>;
  treeSitterClient: ReturnType<typeof getTreeSitterClient>;
};

function renderToolContent({
  toolName,
  input,
  output,
  pending,
  errorText,
  colors,
  syntaxStyle,
  treeSitterClient,
}: RenderToolContentProps) {
  if (!input) {
    return null;
  }

  if (toolName === "shell") {
    return (
      <ShellView
        input={input}
        output={output}
        pending={pending}
        error={errorText}
        colors={colors}
      />
    );
  }

  if (toolName === "editFile") {
    return (
      <EditFileDiff
        input={input}
        pending={pending}
        error={errorText}
        colors={colors}
        syntaxStyle={syntaxStyle}
        treeSitterClient={treeSitterClient}
      />
    );
  }

  if (toolName === "writeFile") {
    return (
      <WriteFilePreview
        input={input}
        pending={pending}
        error={errorText}
        colors={colors}
      />
    );
  }

  if (toolName === "createTodos" || toolName === "updateTodos") {
    return (
      <TodoList
        input={input}
        toolName={toolName}
        pending={pending}
        colors={colors}
      />
    );
  }

  if (toolName === "spawnAgent") {
    const { name, description } = input as { name?: string; description?: string };
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Subagent:</em> {name ?? ""} — {description ?? ""}
        {pending ? " …" : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (isMcpTool(toolName)) {
    return (
      <McpToolView
        toolName={toolName}
        input={input}
        output={output}
        pending={pending}
        error={errorText}
        colors={colors}
      />
    );
  }

  return (
    <text attributes={TextAttributes.DIM}>
      <em fg={colors.info}>{formatToolName(toolName)}:</em>{" "}
      {formatToolArgs(input)}
      {pending ? " …" : ""}
      {errorText ? ` ${errorText}` : ""}
    </text>
  );
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
      const key = isToolPart(part)
        ? `group-tc-${part.toolCallId}`
        : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

export function BotMessage({
  parts,
  model,
  durationMs,
  streaming = false,
  interrupted = false,
  isSubagentRunning = false,
}: Props) {
  const { colors } = useTheme();
  const { mode: currentMode } = usePromptConfig();

  const syntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(colors),
    [colors],
  );

  const renderCodeBlock = useCallback(
    (
      token: { type: string },
      ctx: { defaultRender: () => { bg?: string } | null },
    ) => {
      if (token.type !== "code") return undefined;
      const renderable = ctx.defaultRender();
      if (renderable) renderable.bg = "#313131ff";
      return renderable;
    },
    [],
  );

  const shouldHidePart = (part: ClientMessagePart): boolean => {
    if (!isToolPart(part)) return false;
    const tn =
      part.type === "dynamic-tool"
        ? part.toolName
        : part.type.slice("tool-".length);
    const hasInput =
      "input" in part && part.input != null && part.state !== "input-streaming";
    return (
      (hasInput && tn.includes("memory")) ||
      tn === "askUser" ||
      tn === "manageHook"
    );
  };

  const groups = groupConsecutiveParts(parts).filter(
    (group) => !group.parts.every(shouldHidePart),
  );

  const modeColor =
    currentMode === Mode.PLAN ? colors.planMode : colors.primary;
  const modeLabel = currentMode === Mode.PLAN ? "Plan" : "Build";

  return (
    <box width="100%" alignItems="center">
      {groups.map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if (shouldHidePart(part)) {
              return null;
            }

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
                part.type === "dynamic-tool"
                  ? part.toolName
                  : part.type.slice("tool-".length);
              const pending =
                part.state !== "output-available" &&
                part.state !== "output-error";
              const hasInput =
                "input" in part &&
                part.input != null &&
                part.state !== "input-streaming";
              const errorText =
                part.state === "output-error" ? part.errorText : undefined;
              const output =
                part.state === "output-available"
                  ? (part as unknown as { output: unknown }).output
                  : undefined;

              return (
                <box
                  key={part.toolCallId}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{ ...EmptyBorder, vertical: "│" }}
                  width="100%"
                  paddingX={2}
                >
                  {renderToolContent({
                    toolName,
                    input: hasInput ? part.input : undefined,
                    output,
                    pending,
                    errorText,
                    colors,
                    syntaxStyle,
                    treeSitterClient,
                  })}
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
          {streaming || isSubagentRunning ? (
            <Spinner activeColor={modeColor} />
          ) : (
            <text fg={modeColor}>◉</text>
          )}
          <box flexDirection="row" gap={1}>
            <text>{modeLabel}</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {durationMs != null && (
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
                <text fg={colors.error}>
                  {isSubagentRunning
                    ? "sub agent interrupted"
                    : "agent interrupted"}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}

import { useCallback, useMemo, useState } from "react";
import prettyMs from "pretty-ms";
import {
  BoxRenderable,
  getTreeSitterClient,
  type Renderable,
  TextAttributes,
  TextRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";

import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import { usePromptConfig } from "../../providers/prompt-config";
import type { InlineSystemEvent, Message } from "../../hooks/use-chat";
import { Mode, isMcpTool } from "@koincode/shared";
import { createMarkdownSyntaxStyle } from "../../utils/syntax-style";
import EditFileDiff from "../tool-view/edit-file";
import WriteFilePreview from "../tool-view/write-file";
import PathToolView from "../tool-view/path-view";
import TodoList from "../tool-view/todo-list";
import ShellView from "../tool-view/shell";
import McpToolView, { ManageMcpView } from "../tool-view/mcp-tool";
import { Spinner } from "../spinner";
import { getModelDisplayName } from "../../lib/custom-models";
import { copyToClipboard } from "../../lib/clipboard";
import { isCompiledBinary } from "../../utils/tree-sitter";
import { SystemMessage } from "./system-message";

// getTreeSitterClient() auto-starts a parser worker the moment it's constructed, which in a
// compiled binary fails its WASM load and spams the TUI with errors (see utils/tree-sitter.ts
// for the full explanation) — skip constructing it there entirely. Every consumer below
// (Diff/Markdown/Code renderables) already treats treeSitterClient as optional upstream, so
// this degrades to unhighlighted output.
const treeSitterClient = isCompiledBinary ? undefined : getTreeSitterClient();

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
  inlineEvents?: InlineSystemEvent[];
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
  treeSitterClient: ReturnType<typeof getTreeSitterClient> | undefined;
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
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>{formatToolName(toolName)}:</em>
        {pending ? " …" : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
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
        output={output}
        pending={pending}
        error={errorText}
        colors={colors}
        syntaxStyle={syntaxStyle}
        treeSitterClient={treeSitterClient}
      />
    );
  }

  if (toolName === "readFile" || toolName === "listDirectory") {
    return (
      <PathToolView
        label={toolName === "readFile" ? "Read File" : "List Directory"}
        input={input}
        output={output}
        pending={pending}
        error={errorText}
        colors={colors}
      />
    );
  }

  if (toolName === "writeFile") {
    return (
      <WriteFilePreview
        input={input}
        output={output}
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

  if (toolName === "switchMode") {
    const { target, reason } = input as { target: string; reason?: string };
    const modeColor = target === "BUILD" ? colors.primary : colors.planMode;
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={modeColor}>→ {target}</em>
        {reason ? ` — ${reason}` : ""}
      </text>
    );
  }

  if (toolName === "spawnAgent") {
    const { name, description } = input as {
      name?: string;
      description?: string;
    };
    const backgroundOutput =
      !pending && output != null
        ? (output as { taskId?: string; status?: string }).taskId
          ? (output as { taskId: string; status: string })
          : null
        : null;
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Subagent:</em> {name ?? ""} — {description ?? ""}
        {backgroundOutput
          ? ` — running in background (task ${backgroundOutput.taskId})`
          : ""}
        {pending ? " …" : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "scheduleWakeup") {
    const { reason } = (input ?? {}) as { reason?: string };
    const wakeupOutput =
      !pending && output != null
        ? (output as {
            scheduledFor?: string;
            delaySeconds?: number;
            waitingOnTaskId?: string;
          })
        : null;
    const wakeTime = wakeupOutput?.scheduledFor
      ? new Date(wakeupOutput.scheduledFor).toLocaleTimeString()
      : null;
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Wakeup scheduled:</em> {reason ?? ""}
        {wakeTime
          ? ` — next check-in at ${wakeTime} (in ${wakeupOutput?.delaySeconds}s)`
          : pending
            ? " …"
            : ""}
        {wakeupOutput?.waitingOnTaskId
          ? `, or sooner if task ${wakeupOutput.waitingOnTaskId} finishes first`
          : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "checkAgentTask") {
    const { taskId } = (input ?? {}) as { taskId?: string };
    const checkOutput =
      !pending && output != null
        ? (output as { status?: string; error?: string; result?: string })
        : null;
    const statusText = checkOutput
      ? checkOutput.error && !checkOutput.status
        ? checkOutput.error
        : checkOutput.status === "running"
          ? "still running"
          : checkOutput.status === "error"
            ? `error — ${checkOutput.error ?? "unknown"}`
            : checkOutput.status === "completed"
              ? "completed"
              : ""
      : "";
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Checked task</em> {taskId ?? ""}
        {statusText ? `: ${statusText}` : ""}
        {pending ? " …" : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "glob") {
    const files =
      !pending && output != null ? (output as { files: string[] }).files : null;

    const truncated =
      !pending && output != null
        ? (output as { truncated?: boolean }).truncated
        : false;

    const { pattern, path } = (input ?? {}) as {
      pattern?: string;
      path?: string;
    };

    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Glob:</em> {pattern ?? ""}
        {path ? ` ${path}` : ""}
        {pending
          ? " …"
          : files != null
            ? ` — ${files.length}${truncated ? "+" : ""} file${files.length !== 1 ? "s" : ""}`
            : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "grep") {
    const matches =
      !pending && output != null
        ? (output as { matches: unknown[] }).matches
        : null;

    const truncated =
      !pending && output != null
        ? (output as { truncated?: boolean }).truncated
        : false;

    const { pattern, path, include } = (input ?? {}) as {
      pattern?: string;
      path?: string;
      include?: string;
    };

    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Grep:</em> {pattern ?? ""}
        {path ? ` ${path}` : ""}
        {include ? ` (${include})` : ""}
        {pending
          ? " …"
          : matches != null
            ? ` — ${matches.length}${truncated ? "+" : ""} match${matches.length !== 1 ? "es" : ""}`
            : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "askUser") {
    const { question } = (input ?? {}) as { question?: string };
    const answerOutput =
      !pending && output != null
        ? (output as { value?: string; cancelled?: boolean })
        : null;
    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Asked:</em> {question ?? ""}
        {pending
          ? " …"
          : answerOutput?.cancelled
            ? " — cancelled"
            : answerOutput?.value
              ? ` — ${answerOutput.value}`
              : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "manageHook") {
    const { action, eventType, matcher, scope } = (input ?? {}) as {
      action?: string;
      eventType?: string;
      matcher?: string;
      scope?: string;
    };

    const hookOutput =
      !pending && output != null
        ? (output as {
            message?: string;
            hooks?: Record<string, unknown>;
          })
        : null;

    const summary =
      action === "list"
        ? `list ${scope ?? "project"} hooks`
        : `${action ?? ""} ${eventType ?? ""}${matcher ? ` "${matcher}"` : ""}`;

    const eventCount = hookOutput?.hooks
      ? Object.keys(hookOutput.hooks).length
      : null;

    return (
      <text attributes={TextAttributes.DIM}>
        <em fg={colors.info}>Hook:</em> {summary}
        {pending
          ? " …"
          : hookOutput?.message
            ? ` — ${hookOutput.message}`
            : eventCount != null
              ? ` — ${eventCount} event type${eventCount !== 1 ? "s" : ""} configured`
              : ""}
        {errorText ? ` ${errorText}` : ""}
      </text>
    );
  }

  if (toolName === "manageMcp") {
    return (
      <ManageMcpView
        pending={pending}
        output={output}
        error={errorText}
        colors={colors}
      />
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
  // Cumulative count of raw `parts` consumed through the end of this group. Used to
  // place inline system events (e.g. a mid-turn switchMode divider) at the position
  // they actually occurred, even though hidden/filtered groups don't render.
  endIndex: number;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
      lastGroup.endIndex = i + 1;
    } else {
      const key = isToolPart(part)
        ? `group-tc-${part.toolCallId}`
        : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key, endIndex: i + 1 });
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
  inlineEvents = [],
}: Props) {
  const { colors } = useTheme();
  const { mode: currentMode } = usePromptConfig();

  const [openThinking, setOpenThinking] = useState<Set<string>>(new Set());

  const toggleThinking = useCallback((key: string) => {
    setOpenThinking((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const syntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(colors),
    [colors],
  );

  const renderer = useRenderer();

  const renderCodeBlock = useCallback(
    (
      token: { type: string; text?: string },
      ctx: { defaultRender: () => (Renderable & { bg?: string }) | null },
    ) => {
      if (token.type !== "code") return undefined;
      const renderable = ctx.defaultRender();
      if (!renderable) return undefined;
      renderable.bg = "#313131ff";

      const code = token.text ?? "";

      const wrapper = new BoxRenderable(renderable.ctx, {
        width: "100%",
        position: "relative",
      });
      wrapper.add(renderable);

      const label = new TextRenderable(renderable.ctx, {
        content: " ⧉ copy ",
        fg: colors.info,
        position: "absolute",
        top: 0,
        right: 0,
        zIndex: 1,
        onMouseDown: () => {
          void (async () => {
            const copied =
              (await copyToClipboard(code)) ||
              renderer.copyToClipboardOSC52(code);
            if (label.isDestroyed) return;
            label.content = copied ? " ✓ copied " : " ✗ no clipboard ";
            label.fg = copied ? colors.success : colors.error;
            renderer.requestRender();
            setTimeout(() => {
              if (label.isDestroyed) return;
              label.content = " ⧉ copy ";
              label.fg = colors.info;
              renderer.requestRender();
            }, 1200);
          })();
        },
      });
      wrapper.add(label);

      return wrapper;
    },
    [colors, renderer],
  );

  const shouldHidePart = (part: ClientMessagePart): boolean => {
    if (!isToolPart(part)) return false;
    const tn =
      part.type === "dynamic-tool"
        ? part.toolName
        : part.type.slice("tool-".length);
    const hasInput =
      "input" in part && part.input != null && part.state !== "input-streaming";
    const pending =
      part.state !== "output-available" && part.state !== "output-error";
    return (hasInput && tn.includes("memory")) || (tn === "askUser" && pending);
  };

  const groups = groupConsecutiveParts(parts).filter((group) => {
    if (group.parts.every(shouldHidePart)) return false;
    if (
      group.type === "reasoning" &&
      group.parts.every((p) => p.type === "reasoning" && !p.text.trim())
    )
      return false;
    return true;
  });

  const modeColor =
    currentMode === Mode.PLAN ? colors.planMode : colors.primary;
  const modeLabel = currentMode === Mode.PLAN ? "Plan" : "Build";

  // Interleave inline system events (e.g. a mid-turn switchMode divider) between the
  // groups they actually fell between, using each event's raw-parts-array partIndex
  // against each group's cumulative endIndex. Anything past the last group's endIndex
  // (still streaming, next part hasn't arrived yet) is flushed after the final group.
  type RenderItem =
    | { kind: "group"; group: PartGroup; groupIndex: number }
    | { kind: "event"; event: InlineSystemEvent };

  const renderItems: RenderItem[] = [];
  const sortedEvents = [...inlineEvents].sort(
    (a, b) => a.partIndex - b.partIndex,
  );
  let eventCursor = 0;

  groups.forEach((group, groupIndex) => {
    renderItems.push({ kind: "group", group, groupIndex });
    while (
      eventCursor < sortedEvents.length &&
      sortedEvents[eventCursor]!.partIndex <= group.endIndex
    ) {
      renderItems.push({ kind: "event", event: sortedEvents[eventCursor]! });
      eventCursor++;
    }
  });

  while (eventCursor < sortedEvents.length) {
    renderItems.push({ kind: "event", event: sortedEvents[eventCursor]! });
    eventCursor++;
  }

  return (
    <box width="100%" alignItems="center">
      {renderItems.map((item, idx) => {
        if (item.kind === "event") {
          return <SystemMessage key={item.event.id} text={item.event.text} />;
        }
        const { group, groupIndex: i } = item;
        const afterEvent = idx > 0 && renderItems[idx - 1]!.kind === "event";
        return (
          <box key={group.key} width="100%" paddingTop={i === 0 || afterEvent ? 0 : 1}>
            {group.parts.map((part, j) => {
              if (shouldHidePart(part)) {
                return null;
              }

              if (part.type === "reasoning") {
                const trimmed = part.text.trim();

                if (!trimmed) return null;

                const key = `reasoning-${j}`;

                const isPartStreaming = part.state === "streaming";

                const isExpanded = streaming || openThinking.has(key);

                return (
                  <box
                    key={key}
                    border={["left"]}
                    borderColor={colors.thinkingBorder}
                    customBorderChars={{ ...EmptyBorder, vertical: "│" }}
                    width="100%"
                    paddingX={2}
                  >
                    <box
                      flexDirection="row"
                      gap={1}
                      height={1}
                      onMouseDown={() => !streaming && toggleThinking(key)}
                    >
                      <text attributes={TextAttributes.DIM}>
                        {isPartStreaming ? (
                          <em fg={colors.thinking}>Thinking...</em>
                        ) : (
                          <em fg={colors.thinking}>Thought about it</em>
                        )}
                      </text>
                      <text
                        attributes={TextAttributes.DIM}
                        fg={colors.dimSeparator}
                      >
                        {isExpanded ? "▾" : "▸"}
                      </text>
                    </box>
                    {isExpanded && (
                      <text attributes={TextAttributes.DIM}>{trimmed}</text>
                    )}
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
        );
      })}

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
            <text attributes={TextAttributes.DIM}>
              {getModelDisplayName(model)}
            </text>
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

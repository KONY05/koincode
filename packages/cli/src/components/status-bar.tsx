// import { basename } from "node:path";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";

import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { useUpdateCheck } from "../hooks/use-update-check";
import { useIdeContext } from "../hooks/use-ide-context";
import { useMcpServers } from "../hooks/use-mcp-servers";
import { Mode } from "@koincode/shared";
import type { ContextUsage } from "../hooks/use-chat";
import { SIDEBAR_WIDTH } from "./info-sidebar";

const RING_SEGMENTS = 10;
const RING_THRESHOLD = 70; // from what context percent to show the ring

// Horizontal chrome around this row that isn't available for content: session-shell's
// outer paddingX (4) + input-bar's left border (1) + input-bar's inner paddingX (4).
const STATUS_BAR_CHROME = 9;
// The right-hand section (context ring / selection / file) is left unclamped — its real width
// varies with what's in it (e.g. an active-file path), and this renderer has no API to measure a
// nested box's actual laid-out width from React. This is a conservative estimate covering the
// ring+percent (~15 cols) plus a typical relative file/selection string; erring low here just
// means the left side truncates a little earlier than strictly necessary — it never means the
// two sides collide, since the left box still hard-clips via overflow:hidden as a last resort.
const RIGHT_SECTION_ESTIMATE = 45;
const SEPARATOR_WIDTH = 3; // gap(1) + "›"(1) + gap(1) between adjacent left-side segments
const MIN_SEGMENT_WIDTH = 10;

function buildRing(percent: number): string {
  const filled = Math.min(RING_SEGMENTS, Math.floor(percent / RING_SEGMENTS));
  return "●".repeat(filled) + "○".repeat(RING_SEGMENTS - filled);
}

// This renderer has no CSS-style text-overflow: ellipsis, so segments that would otherwise
// wrap onto a second line are truncated by hand instead.
function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (text.length <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  return text.slice(0, maxWidth - 1) + "…";
}

type Props = {
  contextUsage?: ContextUsage | null;
};

export function StatusBar({ contextUsage }: Props) {
  const { mode, modelDisplayName, voiceInput, infoSidebarVisible } = usePromptConfig();
  const { colors } = useTheme();
  const updateInfo = useUpdateCheck();
  const { width: terminalWidth } = useTerminalDimensions();
  const {
    activeFile,
    fileContextEnabled,
    toggleFileContext,
    selection,
    selectionContextEnabled,
    toggleSelectionContext,
  } = useIdeContext();
  const mcpServerCount = useMcpServers().filter((s) => s.status === "connected").length;

  const showRing = contextUsage !== null && contextUsage !== undefined && contextUsage.percent >= RING_THRESHOLD;
  const ringColor = contextUsage && contextUsage.percent >= 90 ? "red" : "yellow";

  // "Build"/"Plan" is always shown in full — it's short and meant to stay put.
  const modeLabel = mode === Mode.PLAN ? "Plan" : "Build";
  const voiceLabel = voiceInput ? "voice" : null;
  const mcpLabel = mcpServerCount > 0 ? `${mcpServerCount} mcp` : null;
  const updateLabel =
    updateInfo.status === "downloaded"
      ? "restart for update"
      : updateInfo.status !== "current"
        ? "update available · /update"
        : null;

  const availableForLeft = Math.max(
    MIN_SEGMENT_WIDTH,
    terminalWidth -
      STATUS_BAR_CHROME -
      (infoSidebarVisible ? SIDEBAR_WIDTH : 0) -
      RIGHT_SECTION_ESTIMATE,
  );

  function fixedWidthWith(voice: string | null, mcp: string | null): number {
    const count = 2 + (voice ? 1 : 0) + (mcp ? 1 : 0) + (updateLabel ? 1 : 0);
    return modeLabel.length + (voice?.length ?? 0) + (mcp?.length ?? 0) + (count - 1) * SEPARATOR_WIDTH;
  }

  // "Build" itself always fits (availableForLeft has a floor above the length of any mode label),
  // but voice/mcp are decorative extras — shed the lowest-priority one first (mcp, then voice)
  // rather than let a too-narrow terminal hard-clip them mid-word.
  let effectiveVoiceLabel = voiceLabel;
  let effectiveMcpLabel = mcpLabel;
  if (fixedWidthWith(effectiveVoiceLabel, effectiveMcpLabel) > availableForLeft) {
    effectiveMcpLabel = null;
  }
  if (fixedWidthWith(effectiveVoiceLabel, effectiveMcpLabel) > availableForLeft) {
    effectiveVoiceLabel = null;
  }

  // Everything but the model name and update text is short and fixed-length, so only those two
  // compete for the leftover space once the fixed segments and their separators are accounted for.
  const segmentCount = 2 + (effectiveVoiceLabel ? 1 : 0) + (effectiveMcpLabel ? 1 : 0) + (updateLabel ? 1 : 0);
  const fixedWidth =
    modeLabel.length +
    (effectiveVoiceLabel?.length ?? 0) +
    (effectiveMcpLabel?.length ?? 0) +
    (segmentCount - 1) * SEPARATOR_WIDTH;

  // No floor here on purpose: when space is critically tight these should shrink all the way to
  // empty rather than claim more width than truly fits, which would just spill into clipping the
  // fixed segments (mode/voice/mcp) instead — trading a graceful empty segment for a mangled one.
  const flexibleBudget = Math.max(0, availableForLeft - fixedWidth);
  const modelBudget = updateLabel
    ? Math.floor(flexibleBudget * 0.6)
    : flexibleBudget;
  const updateBudget = updateLabel ? flexibleBudget - modelBudget : 0;

  const displayModel = truncateText(modelDisplayName, modelBudget);
  // Drop the update segment entirely rather than show a lone "…" with nothing in front of it.
  const truncatedUpdate = updateLabel ? truncateText(updateLabel, updateBudget) : null;
  const displayUpdate = truncatedUpdate && truncatedUpdate !== "…" ? truncatedUpdate : null;

  return (
    <box flexDirection="row" gap={1} width="100%" justifyContent="space-between">
      <box flexDirection="row" gap={1} flexShrink={1} overflow="hidden">
        <text wrapMode="none" fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
          {modeLabel}
        </text>

        {displayModel && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text wrapMode="none">{displayModel}</text>
          </>
        )}

        {effectiveVoiceLabel && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text wrapMode="none" fg={colors.primary}>{effectiveVoiceLabel}</text>
          </>
        )}

        {effectiveMcpLabel && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text wrapMode="none" attributes={TextAttributes.DIM} fg={colors.info}>
              {effectiveMcpLabel}
            </text>
          </>
        )}

        {displayUpdate && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>›</text>
            <text wrapMode="none" fg={colors.primary}>
              {displayUpdate}
            </text>
          </>
        )}
      </box>

      <box flexDirection="row" gap={2} flexShrink={0}>
        {showRing && (
          <text fg={ringColor}>
            {buildRing(contextUsage!.percent)} {contextUsage!.percent}%
          </text>
        )}
        {selection && (
          <text
            attributes={selectionContextEnabled
              ? TextAttributes.DIM
              : TextAttributes.DIM | TextAttributes.STRIKETHROUGH}
            onMouseDown={toggleSelectionContext}
          >
            {selection.endLine - selection.startLine + 1}{" "}
            {selection.endLine - selection.startLine + 1 === 1 ? "line" : "lines"} selected
            {/* ·{" "}
            {/* {basename(selection.file)}:{selection.startLine}-{selection.endLine} */}
          </text>
        )}
        {!selection && activeFile && (
          <text
            attributes={fileContextEnabled
              ? TextAttributes.DIM
              : TextAttributes.DIM | TextAttributes.STRIKETHROUGH}
            onMouseDown={toggleFileContext}
          >
            In {activeFile}
          </text>
        )}
      </box>
    </box>
  );
}

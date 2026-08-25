// Input-bar placeholder copy, extracted pure so it's unit-testable without
// mounting the TUI (see src/tests/input-placeholder.test.ts). Precedence:
// fully-locked input > handoff block > held/queued counts during compaction >
// ordinary streaming > voice states > default prompt.

export type VoiceState = "idle" | "recording" | "transcribing";

export function getInputBarPlaceholder(
  disabled: boolean,
  submitBlocked: boolean,
  streaming: boolean,
  queueLength: number,
  heldCount: number,
  voiceInput: boolean,
  voiceState: VoiceState,
  placeholderExample: string,
): string {
  if (disabled) return "Agent is thinking… press esc to interrupt";
  if (submitBlocked) return "Handoff in progress — input paused";
  if (streaming && heldCount > 0 && queueLength > 0)
    return `${queueLength} queued · ${heldCount} held — all send after compacting`;
  if (streaming && heldCount > 0)
    return `Compacting context… · ${heldCount} held`;
  if (streaming && queueLength > 0)
    return `${queueLength} queued — press enter to skip ahead`;
  if (streaming) return `Type to queue a message…`;
  if (!voiceInput) return `Ask anything... "${placeholderExample}"`;
  if (voiceState === "recording") return "Recording… ctrl+r to stop";
  if (voiceState === "transcribing") return "Transcribing…";
  return "ctrl+r to record… or type normally";
}

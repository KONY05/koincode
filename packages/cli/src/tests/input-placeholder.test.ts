import { describe, expect, test } from "bun:test";

import { getInputBarPlaceholder, type VoiceState } from "../lib/input-placeholder";

const base = {
  disabled: false,
  submitBlocked: false,
  streaming: false,
  queueLength: 0,
  heldCount: 0,
  voiceInput: false,
  voiceState: "idle" as VoiceState,
  placeholderExample: "fix the failing test",
};

function placeholder(overrides: Partial<typeof base> = {}) {
  return getInputBarPlaceholder(
    overrides.disabled ?? base.disabled,
    overrides.submitBlocked ?? base.submitBlocked,
    overrides.streaming ?? base.streaming,
    overrides.queueLength ?? base.queueLength,
    overrides.heldCount ?? base.heldCount,
    overrides.voiceInput ?? base.voiceInput,
    overrides.voiceState ?? base.voiceState,
    overrides.placeholderExample ?? base.placeholderExample,
  );
}

describe("getInputBarPlaceholder", () => {
  test("default prompt when idle with no voice input", () => {
    expect(placeholder()).toBe('Ask anything... "fix the failing test"');
  });

  test("fully-locked input wins over everything", () => {
    expect(
      placeholder({
        disabled: true,
        submitBlocked: true,
        streaming: true,
        heldCount: 2,
      }),
    ).toBe("Agent is thinking… press esc to interrupt");
  });

  test("handoff block — draft is preserved, not cleared", () => {
    expect(placeholder({ submitBlocked: true, streaming: true })).toBe(
      "Handoff in progress — input paused",
    );
  });

  test("compaction hold surfaces the hidden count", () => {
    // streaming=true during compaction (isCompacting feeds it); the held
    // messages are invisible in the panel, so the placeholder must carry them.
    expect(placeholder({ streaming: true, heldCount: 2 })).toBe(
      "Compacting context… · 2 held",
    );
  });

  test("compaction hold alongside visible queued items shows both counts", () => {
    expect(
      placeholder({ streaming: true, queueLength: 1, heldCount: 2 }),
    ).toBe("1 queued · 2 held — all send after compacting");
  });

  test("ordinary streaming queue hint unchanged", () => {
    expect(placeholder({ streaming: true, queueLength: 3 })).toBe(
      "3 queued — press enter to skip ahead",
    );
  });

  test("plain streaming still invites queuing when nothing is parked", () => {
    expect(placeholder({ streaming: true })).toBe(
      "Type to queue a message…",
    );
  });

  test("voice states only apply when voice input is enabled and idle", () => {
    expect(
      placeholder({ voiceInput: true, voiceState: "recording" }),
    ).toBe("Recording… ctrl+r to stop");
    expect(
      placeholder({ voiceInput: true, voiceState: "transcribing" }),
    ).toBe("Transcribing…");
    expect(placeholder({ voiceInput: true })).toBe(
      "ctrl+r to record… or type normally",
    );
    // Voice copy never outranks active turn states.
    expect(
      placeholder({
        streaming: true,
        heldCount: 1,
        voiceInput: true,
        voiceState: "recording",
      }),
    ).toBe("Compacting context… · 1 held");
  });
});

import { describe, expect, test } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";

import { testRender } from "@opentui/react/test-utils";
import type { Renderable } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";

import { ThemeProvider } from "../providers/theme";
import { ToastProvider } from "../providers/toast";
import { DialogProvider } from "../providers/dialog";
import { KeyboardLayerProvider } from "../providers/keyboard-layer";
import { PromptConfigProvider } from "../providers/prompt-config";
import { SessionActionsProvider } from "../providers/session-actions";
import { InputBar } from "../components/input-bar";

// Depth-first search for the first focusable renderable (InputBar's textarea)
// and grab focus — typing via mockInput only reaches a focused element.
function focusFirstFocusable(setup: TestRendererSetup): void {
  const walk = (node: Renderable): boolean => {
    if (node.focusable && typeof node.focus === "function") {
      node.focus();
      return true;
    }
    for (const child of node.getChildren() ?? []) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(setup.renderer.root);
}

function Harness(props: Parameters<typeof InputBar>[0]) {
  const noop = () => Promise.resolve();
  return (
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <KeyboardLayerProvider>
            <DialogProvider>
              <PromptConfigProvider>
              <SessionActionsProvider
                invokeSkill={noop}
                clearSession={noop}
                handoff={noop}
                compact={noop}
                addWorkspaceRoot={noop}
                workspaceRoots={[]}
              >
                <box style={{ width: "100%", height: 10 }}>
                  <InputBar {...props} />
                </box>
              </SessionActionsProvider>
              </PromptConfigProvider>
            </DialogProvider>
          </KeyboardLayerProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

async function mount(
  props: Parameters<typeof InputBar>[0],
  width = 100,
  height = 12,
): Promise<TestRendererSetup> {
  const setup = await testRender(<Harness {...props} />, { width, height });
  await setup.renderOnce();
  focusFirstFocusable(setup);
  await setup.renderOnce();
  return setup;
}

describe("InputBar under the real opentui reconciler", () => {
  test("typing + enter submits the text through the real key pipeline", async () => {
    const submitted: string[] = [];
    const setup = await mount({ onSubmit: (text) => void submitted.push(text) });

    try {
      await act(async () => {
        setup.mockInput.typeText("hello harness");
        setup.mockInput.pressEnter();
      });
      await setup.flush();

      expect(submitted).toEqual(["hello harness"]);
      // Draft was consumed by the successful submit — drain a repaint first
      // so the capture reflects post-submit state.
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).not.toContain("hello harness");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("submitBlocked refuses enter AND keeps the draft in the box", async () => {
    // The pre-clear guarantee: the rejection must happen before handleSubmit
    // wipes the textarea, or a handoff-window enter destroys the user's draft.
    const submitted: string[] = [];
    const setup = await mount({
      onSubmit: (text) => void submitted.push(text),
      submitBlocked: true,
    });

    try {
      await act(async () => {
        setup.mockInput.typeText("precious draft");
        setup.mockInput.pressEnter();
      });
      await setup.flush();

      expect(submitted).toEqual([]);

      const frame = await setup.waitForFrame((f) =>
        f.includes("Handoff in progress"),
      );
      // Both halves of the contract, asserted against the painted grid:
      expect(frame).toContain("precious draft"); // draft survives
      expect(frame).toContain("message not sent"); // toast explains why
    } finally {
      setup.renderer.destroy();
    }
  });

  test("compaction hold surfaces held count instead of inviting queuing", async () => {
    // streaming=true during compaction; held messages are invisible in the
    // panel so the placeholder is the only place that acknowledges them.
    const setup = await mount({
      onSubmit: () => {},
      streaming: true,
      heldCount: 2,
    });

    try {
      const frame = await setup.waitForFrame((f) =>
        f.includes("Compacting context… · 2 held"),
      );
      expect(frame).not.toContain("Type to queue a message");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("handoff block also wins over force-next on an empty box", async () => {
    // During handoff, streaming is true — Enter on an empty input would
    // normally trigger onForceNext (interrupt). It must not fire.
    let forced = false;
    const setup = await mount({
      onSubmit: () => {},
      onForceNext: () => {
        forced = true;
      },
      submitBlocked: true,
      streaming: true,
      queue: [
        {
          id: "q1",
          userText: "queued item",
          mode: "BUILD",
          model: "test-model",
        },
      ],
    });

    try {
      await act(async () => {
        setup.mockInput.pressEnter();
      });
      await setup.flush();

      expect(forced).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  });
});

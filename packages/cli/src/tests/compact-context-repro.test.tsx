import { describe, expect, test } from "bun:test";
import { act, useEffect, useState } from "react";

import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";

import { ThemeProvider } from "../providers/theme";
import { ToastProvider } from "../providers/toast";
import { PromptConfigProvider } from "../providers/prompt-config";
import { StatusBar } from "../components/status-bar";
import { InfoSidebar } from "../components/info-sidebar";
import type { ContextUsage } from "../hooks/use-chat";

// Reproduction for the post-/compact render crash ("Text must be created inside
// of a text node"): mount the real context-usage consumers and flip contextUsage
// from the stale pre-compact value to the post-compact override value.

const PRE: ContextUsage = {
  tokensUsed: 140769,
  contextWindow: 1_048_576,
  percent: 13,
  hasUsageData: true,
};

const POST: ContextUsage = {
  tokensUsed: 8123,
  contextWindow: 1_048_576,
  percent: 1,
  hasUsageData: true,
};

function Harness({ usage }: { usage: ContextUsage | null }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <PromptConfigProvider>
          <box style={{ width: "100%", height: 14 }} flexDirection="column">
            <StatusBar contextUsage={usage} />
            <InfoSidebar
              contextUsage={usage}
              sessionCost={0.01}
              visible
              workspaceRoots={[]}
            />
          </box>
        </PromptConfigProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

// Mounts with `pre`, then flips to `post` after a tick — mimicking
// markCompacted() updating the contextUsage memo's output.
function Switchable({ pre, post }: { pre: ContextUsage; post: ContextUsage | null }) {
  const [usage, setUsage] = useState<ContextUsage | null>(pre);
  useEffect(() => {
    const t = setTimeout(() => setUsage(post), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Harness usage={usage} />;
}

async function mount(pre: ContextUsage, post: ContextUsage | null): Promise<TestRendererSetup> {
  const setup = await testRender(<Switchable pre={pre} post={post} />, {
    width: 100,
    height: 14,
  });
  await setup.renderOnce();
  return setup;
}

describe("post-compact contextUsage re-render (real reconciler)", () => {
  test("sane pre → post transition does not throw", async () => {
    const setup = await mount(PRE, POST);
    try {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("8,123 tokens");
      expect(frame).toContain("1% used");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("stale server (tokensUsed undefined) degrades to 0 instead of crashing", async () => {
    const stale = {
      tokensUsed: undefined,
      contextWindow: 1_048_576,
      percent: Number.NaN,
      hasUsageData: true,
    } as unknown as ContextUsage;
    const setup = await mount(PRE, stale);
    try {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      // formatNumber must degrade, never throw — a render-time throw trips the
      // renderer's error boundary and replaces the whole tree with red text.
      expect(frame).toContain("0 tokens");
      expect(frame).not.toContain("TypeError");
    } finally {
      setup.renderer.destroy();
    }
  });
});

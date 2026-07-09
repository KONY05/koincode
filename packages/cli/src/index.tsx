import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { Sentry } from "./lib/sentry";
import { trackAppStarted } from "./lib/analytics";
import { initTreeSitter } from "./utils/tree-sitter";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";
import { updateGlobalConfig } from "./utils/configs/global-config";
import { ensureIdeExtension } from "./lib/ide-extension";
import { closeBrowser } from "./tools/browser/browser-session";
import { handleFocusSequence } from "./lib/terminal-focus";
import { cancelAllRegisteredWork } from "./lib/background/session-background-work";
import type { ApiKeys } from "@koincode/shared";

// Handle key-saving flags before starting the TUI
const KEY_FLAGS: Array<{ flag: string; apiKey: keyof ApiKeys }> = [
  { flag: "--openrouter-key", apiKey: "openrouter" },
  { flag: "--anthropic-key", apiKey: "anthropic" },
  { flag: "--openai-key", apiKey: "openai" },
  { flag: "--gemini-key", apiKey: "gemini" },
];

const args = process.argv.slice(2).map((a) => a.trim());

for (const { flag, apiKey } of KEY_FLAGS) {
  // Support both --flag=value and --flag value
  const eqArg = args.find((a) => a.startsWith(`${flag}=`));
  const idx = args.indexOf(flag);
  const value = eqArg
    ? eqArg.slice(flag.length + 1)
    : idx !== -1 && args[idx + 1] != null && !args[idx + 1]!.startsWith("--")
      ? args[idx + 1]!
      : undefined;

  if (value) {
    updateGlobalConfig({ apiKeys: { [apiKey]: value } });
    process.stdout.write(
      `✓ ${flag.replace("--", "").replace("-key", "")} key saved\n`,
    );
  }
}

ensureIdeExtension();
trackAppStarted();
await initTreeSitter();

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "sessions/new", element: <NewSession /> },
      { path: "sessions/:id", element: <Session /> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

if (process.env.TERM_PROGRAM === "Apple_Terminal") {
  process.stderr.write(
    "\x1b[33m⚠ Note:\x1b[0m macOS Terminal.app detected — theme colors will be adapted to 256-color mode.\n" +
      "For full true-color themes use iTerm2, Ghostty, or WezTerm.\n\n",
  );
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
  prependInputHandlers: [handleFocusSequence],
});

// Enable DEC focus reporting so we know when the terminal window is backgrounded
// (used to decide whether to ring the bell when the agent needs the user).
process.stdout.write("\x1b[?1004h");

function shutdown(code = 0) {
  process.stdout.write("\x1b[?1004l");
  // process.exit() below never unmounts the Session screen, so the usual
  // per-session cleanup effect (kills backgrounded shell processes, aborts
  // in-flight background sub-agents) never runs on its own — do it
  // explicitly here first, same reasoning as the /exit command.
  cancelAllRegisteredWork();
  renderer.destroy();
  void closeBrowser().finally(() => process.exit(code));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  Sentry.captureException(error);
  shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(
    reason instanceof Error ? reason : new Error(String(reason)),
  );
});

createRoot(renderer).render(<App />);

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";
import { updateConfig } from "./lib/config";
import type { ApiKeys } from "@koincode/shared";

// Handle key-saving flags before starting the TUI
const KEY_FLAGS: Array<{ flag: string; apiKey: keyof ApiKeys }> = [
  { flag: "--openrouter-key", apiKey: "openrouter" },
  { flag: "--anthropic-key",  apiKey: "anthropic" },
  { flag: "--openai-key",     apiKey: "openai" },
  { flag: "--gemini-key",     apiKey: "gemini" },
];

const args = process.argv.slice(2);
let savedAnyKey = false;

for (const { flag, apiKey } of KEY_FLAGS) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    updateConfig({ apiKeys: { [apiKey]: args[idx + 1] } });
    process.stdout.write(`✓ ${flag.replace("--", "").replace("-key", "")} key saved\n`);
    savedAnyKey = true;
  }
}

if (savedAnyKey) {
  process.exit(0);
}

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "sessions/new", element: <NewSession /> },
      { path: "sessions/:id", element: <Session /> },
    ]
  }
]);

function App() {
  return <RouterProvider router={router} />
}

if (process.env.TERM_PROGRAM === "Apple_Terminal") {
  process.stderr.write(
    "\x1b[33m⚠ Warning:\x1b[0m macOS Terminal.app has limited true-color support — themes may render incorrectly.\n" +
    "For best results use iTerm2, Ghostty, or Warp.\n\n"
  );
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);

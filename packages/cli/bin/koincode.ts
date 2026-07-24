#!/usr/bin/env bun

import { version } from "../package.json";

const HELP_TEXT = `koincode v${version}
An open source local-first terminal coding agent.

Usage: koincode [options]

Options:
  -h, --help                Show this help message and exit
  -v, --version             Print the installed version and exit
  --port <number>           Run the server on a custom port (default: 37420)
  --anthropic-key <key>     Save an Anthropic API key
  --openai-key <key>        Save an OpenAI API key
  --google-key <key>        Save a Google Gemini API key
  --xai-key <key>           Save an xAI API key
  --openrouter-key <key>    Save an OpenRouter API key
  --enable-browser-tools    Enable Playwright-based browser tools
  --disable-browser-tools   Disable browser tools
  --info                    Show the info sidebar (context, cost, mcp, modified files)
  --update                  Update koincode to the latest version
  --server                  Run only the API server (no terminal UI)

Run \`koincode\` with no options to start the terminal UI.
Use \`/setup\` inside a session to add API keys interactively.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(`v${version}\n`);
  process.exit(0);
}

if (process.argv.includes("--server")) {
  const server = await import("@koincode/server");
  Bun.serve(server.default);
} else if (process.argv.includes("--update")) {
  const { runCliUpdate } = await import("../src/lib/update-cli");
  await runCliUpdate();
} else {
  const { ensureServerRunning } = await import("../src/lib/server-manager");
  const { updateGlobalConfig } = await import("../src/utils/configs/global-config");
  const { resolveBrowser } = await import("../src/lib/browser-setup");
  // Loaded up front (before the risky startup below) so it's guaranteed available even if the
  // render tree is exactly what crashes — it's deliberately opentui-free. See startup-recovery.ts.
  const { handleStartupCrash } = await import("../src/lib/startup-recovery");

  const args = process.argv.slice(2);

  // --enable-browser-tools: enable browser tools and resolve browser
  if (args.includes("--enable-browser-tools")) {
    updateGlobalConfig({ browser: { enabled: true } });
    const resolution = resolveBrowser();
    if (resolution.type === "chrome") {
      process.stdout.write(`✓ Browser tools enabled (using system Chrome)\n`);
    } else if (resolution.type === "playwright-cache") {
      process.stdout.write(`✓ Browser tools enabled (using cached Playwright Chromium)\n`);
    } else {
      process.stdout.write(
        `✓ Browser tools enabled\n` +
        `⚠ No browser found. Install Chrome or run: npx playwright install chromium\n`,
      );
    }
  }

  // --disable-browser-tools: disable browser tools
  if (args.includes("--disable-browser-tools")) {
    updateGlobalConfig({ browser: { enabled: false } });
    process.stdout.write(`✓ Browser tools disabled\n`);
  }

  // Parse port flag before server starts
  const portEqArg = args.find((a) => a.startsWith("--port="));
  const portIndex = args.indexOf("--port");
  const nextArg = args[portIndex + 1];
  const portValue = portEqArg
    ? portEqArg.slice("--port=".length)
    : portIndex !== -1 && nextArg && !nextArg.startsWith("--")
      ? nextArg
      : undefined;

  if (portValue) {
    const port = parseInt(portValue, 10);

    if (!isNaN(port) && port > 0 && port < 65536) {
      updateGlobalConfig({ port });
    }
  }

  // Crash-guard: if the app can't even start (a bad build that throws during server bring-up or
  // while importing the render tree), self-heal by updating to a newer release if one exists,
  // instead of leaving the user stranded on a broken binary. See startup-recovery.ts.
  try {
    await ensureServerRunning();
    await import("../src/index.tsx");
  } catch (err) {
    await handleStartupCrash(err);
  }
}

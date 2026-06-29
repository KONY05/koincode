#!/usr/bin/env bun

// Single-binary server mode: when invoked with --server, start the server
// and skip the CLI entirely. This allows the compiled binary to spawn itself
// as a background server process.
if (process.argv.includes("--server")) {
  const server = await import("@koincode/server");
  Bun.serve(server.default);
} else {
  const { ensureServerRunning } = await import("../src/lib/server-manager");
  const { updateGlobalConfig } = await import("../src/utils/configs/global-config");
  const { resolveBrowser } = await import("../src/lib/browser-setup");

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

  await ensureServerRunning();

  await import("../src/index.tsx");
}

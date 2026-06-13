#!/usr/bin/env bun
import { ensureServerRunning } from "../src/lib/server-manager";
import { updateGlobalConfig } from "../src/utils/configs/global-config";

// Parse port flag before server starts (port affects server startup)
const args = process.argv.slice(2);
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

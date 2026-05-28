import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { CONFIG_DIR, PID_FILE, SERVER_PORT } from "@koincode/shared";
import { readConfig } from "./config";

const LOG_FILE = `${CONFIG_DIR}/server.log`;

const isDev = process.env.NODE_ENV === "development";

// In dev, point at the source file with hot-reload.
// In prod (bun link / compiled), point at the installed server entry.
const SERVER_ENTRY = isDev
  ? path.join(import.meta.dirname, "../../../server/src/index.ts")
  : path.join(import.meta.dirname, "../../server/src/index.ts");

async function isServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${SERVER_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function spawnServer() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const logFd = fs.openSync(LOG_FILE, "w");
  const args = isDev ? ["--hot", SERVER_ENTRY] : [SERVER_ENTRY];
  const config = readConfig();

  const server = spawn("bun", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      NODE_ENV: process.env.NODE_ENV ?? "production",
      // Config file keys take precedence over shell env vars
      ...(config.apiKeys?.anthropic  && { ANTHROPIC_API_KEY: config.apiKeys.anthropic }),
      ...(config.apiKeys?.openai     && { OPENAI_API_KEY: config.apiKeys.openai }),
      ...(config.apiKeys?.gemini     && { GOOGLE_GENERATIVE_AI_API_KEY: config.apiKeys.gemini }),
      ...(config.apiKeys?.openrouter && { OPENROUTER_API_KEY: config.apiKeys.openrouter }),
    },
  });

  fs.closeSync(logFd);

  if (server.pid) {
    fs.writeFileSync(PID_FILE, String(server.pid));
  }

  server.unref();
}

export async function ensureServerRunning(): Promise<void> {
  if (await isServerHealthy()) return;

  spawnServer();

  const ready = await waitForServer();
  if (!ready) {
    throw new Error(
      `Koincode server failed to start on port ${SERVER_PORT} within 15 seconds.`,
    );
  }
}

export async function restartServer(): Promise<void> {
  // Kill the existing process if we have a PID on record
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (pid) process.kill(pid);
  } catch {
    // No PID or already dead — continue to spawn
  }

  spawnServer();

  const ready = await waitForServer();
  if (!ready) {
    throw new Error(
      `Koincode server failed to restart on port ${SERVER_PORT} within 15 seconds.`,
    );
  }
}

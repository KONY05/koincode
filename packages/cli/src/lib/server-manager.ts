import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";

import { GLOBAL_CONFIG_DIR, PID_FILE, SERVER_PORT } from "@koincode/shared";
import { readGlobalConfig } from "../utils/configs/global-config";

const LOG_FILE = `${GLOBAL_CONFIG_DIR}/server.log`;

const isDev = process.env.NODE_ENV === "development";

// In dev, point at the source file with hot-reload.
// In prod (bun link / compiled), point at the installed server entry.
const SERVER_ENTRY = isDev
  ? path.join(import.meta.dirname, "../../../server/src/index.ts")
  : path.join(import.meta.dirname, "../../server/src/index.ts");

function getServerPort(): number {
  const config = readGlobalConfig();
  return config.port ?? SERVER_PORT;
}

function killPortIfInUse(port: number): void {
  try {
    const pids = execSync(`lsof -ti tcp:${port}`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();

    if (pids) {
      // Check if any of the PIDs are our own server
      try {
        const ourPid = Number(fs.readFileSync(PID_FILE, "utf-8").trim());
        const pidList = pids.split("\n").map(Number);

        // If only our PID is using the port, just kill it
        if (pidList.length === 1 && pidList[0] === ourPid) {
          process.kill(ourPid);
          fs.unlinkSync(PID_FILE);
          return;
        }

        // If other processes are using the port, warn the user
        console.warn(
          `⚠️  Port ${port} is already in use by another process (PID: ${pids})`,
        );
        console.warn(`   Use a different port with: koincode --port <port>`);
        throw new Error(`Port ${port} is already in use`);
      } catch {
        // Couldn't read PID file or PID doesn't match, try to kill
        execSync(`lsof -ti tcp:${port} | xargs kill -9`, {
          stdio: "ignore",
        });
      }
    }
  } catch (e) {
    // lsof failed or port not in use - that's fine
    // But if it's our specific error about port in use, rethrow it
    if (
      e instanceof Error &&
      e.message.includes("Port ${port} is already in use")
    ) {
      throw e;
    }
  }
}

async function isServerHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(
  port: number,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function spawnServer(port: number) {
  fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

  const logFd = fs.openSync(LOG_FILE, "w");
  const args = isDev ? ["--hot", SERVER_ENTRY] : [SERVER_ENTRY];
  const config = readGlobalConfig();

  const server = spawn("bun", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: process.env.NODE_ENV ?? "production",
      // Config file keys take precedence over shell env vars
      ...(config.apiKeys?.anthropic && {
        ANTHROPIC_API_KEY: config.apiKeys.anthropic,
      }),
      ...(config.apiKeys?.openai && { OPENAI_API_KEY: config.apiKeys.openai }),
      ...(config.apiKeys?.gemini && {
        GOOGLE_GENERATIVE_AI_API_KEY: config.apiKeys.gemini,
      }),
      ...(config.apiKeys?.openrouter && {
        OPENROUTER_API_KEY: config.apiKeys.openrouter,
      }),
    },
  });

  fs.closeSync(logFd);

  if (server.pid) {
    fs.writeFileSync(PID_FILE, String(server.pid));
  }

  server.unref();
}

export async function ensureServerRunning(): Promise<void> {
  const port = getServerPort();
  if (await isServerHealthy(port)) return;

  killPortIfInUse(port);
  spawnServer(port);

  const ready = await waitForServer(port, 30_000);
  if (!ready) {
    throw new Error(
      `Koincode server failed to start on port ${port} within 30 seconds.`,
    );
  }
}

export async function restartServer(): Promise<void> {
  const port = getServerPort();
  // Kill the existing process if we have a PID on record
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (pid) process.kill(pid);
  } catch {
    // No PID or already dead — continue to spawn
  }

  killPortIfInUse(port);
  spawnServer(port);

  const ready = await waitForServer(port, 30_000);
  if (!ready) {
    throw new Error(
      `Koincode server failed to restart on port ${port} within 30 seconds.`,
    );
  }
}

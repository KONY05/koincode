import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";

import { GLOBAL_CONFIG_DIR, PID_FILE, SERVER_PORT } from "@koincode/shared";
import { readGlobalConfig } from "../utils/configs/global-config";
import { version as OUR_VERSION } from "../../package.json";
import { compareVersions } from "./version";

const LOG_FILE = `${GLOBAL_CONFIG_DIR}/server.log`;

// In a compiled binary, process.execPath IS the binary (e.g. /path/to/koincode-darwin-x64).
// In a regular Bun script, process.execPath is the Bun runtime (e.g. /usr/local/bin/bun).
const execName = path.basename(process.execPath);
const isCompiledBinary = execName !== "bun" && execName !== "bun.exe";

const SERVER_ENTRY_DEV = path.join(import.meta.dirname, "../../../server/src/index.ts");
const isDev = !isCompiledBinary;

function getServerPort(): number {
  const config = readGlobalConfig();
  return config.port ?? SERVER_PORT;
}

// True if the given PID's command line looks like one of our own server processes: the compiled
// binary spawned with `--server`, or the dev server (`bun --hot .../server/src/index.ts`). Used
// to tell our own stale/orphaned servers apart from foreign processes squatting on the port.
function isOurServerProcess(pid: number): boolean {
  try {
    const command = execSync(`ps -p ${pid} -o command=`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    return (
      command.includes("--server") || command.includes("server/src/index.ts")
    );
  } catch {
    // Process already gone or ps failed — treat as foreign; never kill what we can't identify.
    return false;
  }
}

function killPortIfInUse(port: number): void {
  let pids: number[];
  try {
    // Only listeners count as squatters — `-sTCP:LISTEN` excludes client sockets whose remote
    // port happens to be ours (e.g. an in-flight request from another koincode instance).
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    pids = out ? out.split("\n").map(Number) : [];
  } catch {
    // lsof failed or no listener on the port — nothing to free
    return;
  }
  if (pids.length === 0) return;

  // A foreign process holds the port. Fail fast with an actionable message instead of silently
  // `kill -9`ing it — and instead of swallowing the error here, which used to hang startup for
  // the full timeout before failing with a misleading "failed to start" error.
  const foreignPids = pids.filter((pid) => !isOurServerProcess(pid));
  if (foreignPids.length > 0) {
    console.warn(
      `⚠️  Port ${port} is already in use by another process (PID: ${foreignPids.join(", ")})`,
    );
    console.warn(`   Use a different port with: koincode --port <port>`);
    throw new Error(`Port ${port} is already in use by another process`);
  }

  // Every listener is our own server (a stale instance whose PID file was lost, or a
  // version-skewed one we're about to replace) — kill them so we can respawn ours.
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead
    }
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // No PID file on record — fine
  }
}

type ServerStatus = { healthy: boolean; version: string | null };

async function checkServer(port: number): Promise<ServerStatus> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { healthy: false, version: null };
    const body = (await res.json().catch(() => ({}))) as { version?: string | null };
    return { healthy: true, version: body.version ?? null };
  } catch {
    return { healthy: false, version: null };
  }
}

// Whether a healthy server is actually the one we should use. Only compiled binaries can suffer
// version skew — a stale or foreign koincode build's `--server` squatting the shared fixed port,
// which a fresh client would otherwise silently reuse. That mismatched server has a different
// model registry and response shape (it rejects models it doesn't know → "invalid request body",
// omits newer session fields → dialogs blank out).
//
// Upgrade-only rule: reuse the server if it's our version OR NEWER; only reject (→ kill + respawn
// ours) if it's strictly OLDER. This makes the newest running client win the shared port while
// older clients defer to it, rather than two different-version instances ping-ponging kills at
// each other. A version-less server (the old /health shape, predating the `version` field) counts
// as older, so it always gets upgraded. In dev the server is always current source (`bun --hot`)
// and reports no version, so skip the gate entirely — there's no stale-binary problem there.
function isServerAcceptable(status: ServerStatus): boolean {
  if (!status.healthy) return false;
  if (!isCompiledBinary) return true;
  if (status.version === null) return false; // old server, predates versioning → older → upgrade
  return compareVersions(status.version, OUR_VERSION) >= 0;
}

async function waitForServer(
  port: number,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isServerAcceptable(await checkServer(port))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Timeout error enriched with the tail of the server log — a genuine crash (bind failure, bad
// env, native-module load failure) lands in LOG_FILE via spawnServer's stdio redirection, so
// surface it instead of reporting a bare timeout with the real cause buried in the log file.
// A crashed runtime dumps huge minified bundle lines around the actual error, so prefer lines
// that look like the failure itself and clip every line to keep the message readable.
const ERROR_LINE_PATTERN =
  /error|fail|eaddrinuse|eacces|eperm|denied|dlopen|invalid|cannot|unable|exception|glibc/i;
const MAX_TAIL_LINES = 5;
const MAX_LINE_LENGTH = 160;

function serverStartupError(action: "start" | "restart", port: number): Error {
  let logTail = "";
  try {
    const lines = fs
      .readFileSync(LOG_FILE, "utf-8")
      .split("\n")
      .filter((line) => line.trim());
    let tail = lines
      .filter((line) => ERROR_LINE_PATTERN.test(line))
      .slice(-MAX_TAIL_LINES);
    if (tail.length === 0) tail = lines.slice(-MAX_TAIL_LINES);
    if (tail.length > 0) {
      const clipped = tail.map((line) =>
        line.length > MAX_LINE_LENGTH
          ? `${line.slice(0, MAX_LINE_LENGTH - 3)}...`
          : line,
      );
      logTail = `\n\nLast server log lines (${LOG_FILE}):\n${clipped.join("\n")}`;
    }
  } catch {
    // Log file missing or unreadable — skip the excerpt
  }
  return new Error(
    `Koincode server failed to ${action} on port ${port} within 30 seconds.${logTail}`,
  );
}

function spawnServer(port: number) {
  fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

  const logFd = fs.openSync(LOG_FILE, "w");
  const config = readGlobalConfig();

  const env = {
    ...process.env,
    PORT: String(port),
    __KOINCODE_VERSION__: OUR_VERSION, // for non-compiled paths (dev, npmJS-bundle fallback)
    NODE_ENV: isDev ? "development" : "production",
    ...(config.apiKeys?.anthropic && {
      ANTHROPIC_API_KEY: config.apiKeys.anthropic,
    }),
    ...(config.apiKeys?.openai && { OPENAI_API_KEY: config.apiKeys.openai }),
    ...(config.apiKeys?.google && {
      GOOGLE_GENERATIVE_AI_API_KEY: config.apiKeys.google,
    }),
    ...(config.apiKeys?.xai && { XAI_API_KEY: config.apiKeys.xai }),
    ...(config.apiKeys?.openrouter && {
      OPENROUTER_API_KEY: config.apiKeys.openrouter,
    }),
  };

  let server;

  if (isCompiledBinary) {
    // Compiled binary: spawn self with --server flag
    server = spawn(process.execPath, ["--server"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env,
    });
  } else {
    // Dev: run server source directly with hot reload
    server = spawn("bun", ["--hot", SERVER_ENTRY_DEV], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env,
    });
  }

  fs.closeSync(logFd);

  if (server.pid) {
    fs.writeFileSync(PID_FILE, String(server.pid));
  }

  server.unref();
}

export async function ensureServerRunning(): Promise<void> {
  const port = getServerPort();
  // Reuse an existing server only if it's healthy AND our build (or we're in dev). A version
  // mismatch means a stale/foreign server is on the port — fall through to kill + respawn ours.
  if (isServerAcceptable(await checkServer(port))) return;

  killPortIfInUse(port);
  spawnServer(port);

  const ready = await waitForServer(port, 30_000);
  if (!ready) {
    throw serverStartupError("start", port);
  }
}

// fetchWithRestart is now wired into every apiClient call plus the chat transport, so several
// requests can hit a dead server at nearly the same moment — without this guard, each would
// independently kill-and-respawn, racing to spawn multiple server processes on the same port.
// Concurrent callers instead share the one in-flight restart.
let restartInFlight: Promise<void> | null = null;

export function restartServer(): Promise<void> {
  if (restartInFlight) return restartInFlight;

  restartInFlight = (async () => {
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
      throw serverStartupError("restart", port);
    }
  })().finally(() => {
    restartInFlight = null;
  });

  return restartInFlight;
}

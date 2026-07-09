import { toolInputSchemas } from "@koincode/shared";
import {
  registerBackgroundProcess,
  markProcessExited,
} from "../../lib/background/background-process-status";
import { registerBackgroundWork } from "../../lib/background/session-background-work";
import {
  registerServerLogBuffer,
  appendServerLog,
  getServerLog,
} from "../../lib/background/server-log-buffer";

async function streamToLogBuffer(
  stream: ReadableStream<Uint8Array> | null,
  pid: number,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      appendServerLog(pid, decoder.decode(value, { stream: true }));
    }
  } catch {
    // Stream errored (e.g. process killed mid-read) — buffer just stops growing.
  }
}

export async function runServerStart(input: unknown, sessionId?: string) {
  const { command, port, timeout } = toolInputSchemas.serverStart.parse(input);

  const shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL ?? "/bin/sh");
  const shellArgs = process.platform === "win32" ? [shell, "/c", command] : [shell, "-c", command];

  const proc = Bun.spawn(shellArgs, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  registerBackgroundProcess(proc.pid);
  registerServerLogBuffer(proc.pid);

  // Captured continuously, not just during the readiness wait below — so
  // checkServerLogs can inspect output from a long-running server, not only
  // its startup banner.
  void streamToLogBuffer(proc.stdout, proc.pid);
  void streamToLogBuffer(proc.stderr, proc.pid);

  void proc.exited.then((exitCode) => markProcessExited(proc.pid, exitCode));

  if (sessionId) {
    const deregister = registerBackgroundWork(sessionId, () => proc.kill());
    // Don't leak the registration once the process exits on its own (or via serverStop).
    void proc.exited.then(deregister);
  }

  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    try {
      await Bun.connect({
        hostname: "localhost",
        port,
        socket: {
          data() {},
          open(socket) {
            socket.end();
          },
          error() {},
          close() {},
        },
      });
      return {
        ready: true,
        port,
        pid: proc.pid,
        message: `Server ready on port ${port} (PID ${proc.pid}). Use checkServerLogs with this PID to inspect its output, and serverStop to stop it when done.`,
      };
    } catch {
      await Bun.sleep(500);
    }
  }

  proc.kill();
  const logs = getServerLog(proc.pid);
  return {
    ready: false,
    port,
    message: `Timed out waiting for port ${port} after ${timeout}s`,
    logs: logs || "(no output captured)",
  };
}

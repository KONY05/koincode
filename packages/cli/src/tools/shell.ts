import { toolInputSchemas } from "@koincode/shared";
import {
  DEFAULT_TIMEOUT,
  MAX_OUTPUT,
  resolveFromCwd,
  truncate,
  truncateTail,
} from "./utils";
import { registerBackgroundWork } from "../lib/background/session-background-work";
import {
  registerBackgroundProcess,
  markProcessExited
} from "../lib/background/background-process-status";
import {
  createBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
} from "../lib/background/background-tasks";

const BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf ~/",
  "rm -rf /*",
  "rm -rf ~",
  "dd if=/dev/zero",
  "dd if=/dev/random",
  "mkfs",
  ":(){ :|:& };:",
  "chmod 777 /",
  "chmod -r 777 /",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
];

function findBlockedPattern(command: string): string | null {
  const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    BLOCKED_COMMANDS.find((pattern) => normalized.includes(pattern)) ?? null
  );
}

export async function runShellCommand(input: unknown, sessionId?: string) {
  const { command, description, timeout, run_in_background } =
    toolInputSchemas.shell.parse(input);

  const blocked = findBlockedPattern(command);
  if (blocked) {
    throw new Error(`Command blocked for safety: matched pattern "${blocked}"`);
  }

  const shell =
    process.platform === "win32" ? "cmd.exe" : (process.env.SHELL ?? "/bin/sh");

  const shellArgs =
    process.platform === "win32"
      ? [shell, "/c", command]
      : [shell, "-c", command];

  if (run_in_background) {
    const proc = Bun.spawn(shellArgs, {
      cwd: resolveFromCwd(".").resolved,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    registerBackgroundProcess(proc.pid);

    const taskId = createBackgroundTask("shell", description, String(proc.pid));

    // Background commands are expected to potentially run indefinitely by
    // design (a build/test/watch process) — unlike the foreground path, no
    // default timeout is applied. Only kill it if the model explicitly asked
    // for a bound via `timeout`.
    let timedOut = false;
    const timer =
      timeout != null
        ? setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, timeout)
        : null;

    void (async () => {
      try {
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        if (timer) clearTimeout(timer);

        markProcessExited(proc.pid, exitCode);

        // A non-zero exit code is a normal, informative result (e.g. a `ps -p`
        // liveness check), not necessarily a failure — same reasoning as the
        // tool-view's own success/error indicator. Only an exception below
        // (the process failing to run at all) counts as a task error.
        const output = [stdout, stderr].filter(Boolean).join("\n");
        const status = timedOut
          ? `timed out after ${timeout}ms and was killed`
          : `finished — exit ${exitCode}`;
        const deliveryText =
          `Background shell command (PID ${proc.pid}, "${command}") ${status}.` +
          (output
            ? `\n\nOutput:\n${truncateTail(output, MAX_OUTPUT)}`
            : "\n\nNo output.");

        completeBackgroundTask(taskId, deliveryText);
      } catch (error) {
        if (timer) clearTimeout(timer);
        failBackgroundTask(
          taskId,
          `Background shell command (PID ${proc.pid}, "${command}") failed to run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();

    if (sessionId) {
      const deregister = registerBackgroundWork(sessionId, () => proc.kill());
      // Don't leak the registration once the process exits on its own.
      void proc.exited.then(deregister);
    }

    return {
      pid: proc.pid,
      message: `Process started in background (PID ${proc.pid}). Its result will be delivered here automatically once it exits — no need to poll. Optionally use scheduleWakeup with waitingOnTaskId: "${proc.pid}" to also resume with a specific follow-up prompt the moment it's done.`,
    };
  }

  const proc = Bun.spawn(shellArgs, {
    cwd: resolveFromCwd(".").resolved,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "dumb" },
  });

  const timer = setTimeout(() => proc.kill(), timeout ?? DEFAULT_TIMEOUT);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  clearTimeout(timer);

  return {
    stdout: truncate(stdout, MAX_OUTPUT),
    stderr: truncate(stderr, MAX_OUTPUT),
    exitCode,
  };
}

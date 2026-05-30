import { toolInputSchemas } from "@koincode/shared";
import { DEFAULT_TIMEOUT, MAX_OUTPUT, resolveInsideCwd, truncate } from "./utils";

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
  return BLOCKED_COMMANDS.find((pattern) => normalized.includes(pattern)) ?? null;
}

export async function runShellCommand(input: unknown) {
  const { command, timeout = DEFAULT_TIMEOUT } = toolInputSchemas.shell.parse(input);

  const blocked = findBlockedPattern(command);
  if (blocked) {
    throw new Error(`Command blocked for safety: matched pattern "${blocked}"`);
  }

  const shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL ?? "/bin/sh");
  const shellArgs = process.platform === "win32"
    ? [shell, "/c", command]
    : [shell, "-c", command];

  const proc = Bun.spawn(shellArgs, {
    cwd: resolveInsideCwd(".").resolved,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "dumb" },
  });
  const timer = setTimeout(() => proc.kill(), timeout);
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

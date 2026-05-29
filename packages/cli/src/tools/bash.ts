import { toolInputSchemas } from "@koincode/shared";
import { DEFAULT_TIMEOUT, MAX_OUTPUT, resolveInsideCwd, truncate } from "./utils";

export async function runBash(input: unknown) {
  const { command, timeout = DEFAULT_TIMEOUT } = toolInputSchemas.bash.parse(input);
  const proc = Bun.spawn(["bash", "-c", command], {
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

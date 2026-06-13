import { toolInputSchemas } from "@koincode/shared";

export async function runServerStart(input: unknown) {
  const { command, port, timeout } = toolInputSchemas.serverStart.parse(input);

  const shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL ?? "/bin/sh");
  const shellArgs = process.platform === "win32" ? [shell, "/c", command] : [shell, "-c", command];

  const proc = Bun.spawn(shellArgs, {
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env },
  });

  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    try {
      await Bun.connect({
        hostname: "localhost",
        port,
        socket: {
          data() {},
          open(socket) { socket.end(); },
          error() {},
          close() {},
        },
      });
      return { ready: true, port, pid: proc.pid, message: `Server ready on port ${port}` };
    } catch {
      await Bun.sleep(500);
    }
  }

  proc.kill();
  return { ready: false, port, message: `Timed out waiting for port ${port} after ${timeout}s` };
}

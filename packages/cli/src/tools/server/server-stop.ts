import { toolInputSchemas } from "@koincode/shared";
import { getProcessStatus } from "../../lib/background/background-process-status";

export function runServerStop(input: unknown) {
  const { pid } = toolInputSchemas.serverStop.parse(input);

  const status = getProcessStatus(pid);
  if (status === undefined) {
    return {
      error: `No tracked server with PID ${pid} — either it wasn't started with serverStart, or the app has restarted since.`,
    };
  }
  if (status.exited) {
    return {
      alreadyStopped: true,
      message: `Server (PID ${pid}) had already exited (exit ${status.exitCode}).`,
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    return {
      error: `Failed to stop PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { stopped: true, message: `Sent SIGTERM to server (PID ${pid}).` };
}

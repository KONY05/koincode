import { toolInputSchemas } from "@koincode/shared";
import { getServerLog } from "../../lib/background/server-log-buffer";
import { getProcessStatus } from "../../lib/background/background-process-status";

export function runCheckServerLogs(input: unknown) {
  const { pid } = toolInputSchemas.checkServerLogs.parse(input);

  const logs = getServerLog(pid);
  if (logs === undefined) {
    return {
      error: `No server log buffer found for PID ${pid} — either it wasn't started with serverStart, or the app has restarted since.`,
    };
  }

  const status = getProcessStatus(pid);
  const running = status !== undefined && !status.exited;

  return { running, logs: logs || "(no output yet)" };
}

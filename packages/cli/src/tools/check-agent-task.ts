import { toolInputSchemas } from "@koincode/shared";
import { getBackgroundTask } from "../lib/background/background-tasks";

export function runCheckAgentTask(input: unknown) {
  const { taskId } = toolInputSchemas.checkAgentTask.parse(input);

  const task = getBackgroundTask(taskId);
  if (!task) {
    return { error: `No background task found with id ${taskId}` };
  }

  if (task.status === "running") {
    return { status: "running" as const };
  }

  if (task.status === "error") {
    return { status: "error" as const, error: task.error };
  }

  return { status: "completed" as const, result: task.result };
}

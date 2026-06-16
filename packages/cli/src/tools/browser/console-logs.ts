import { toolInputSchemas } from "@koincode/shared";
import { getConsoleLogs, clearConsoleLogs } from "./browser-session";

// Playwright uses "warning" internally; the schema exposes "warn" for brevity.
const TYPE_MAP: Record<string, string> = { warn: "warning" };

export function runBrowserGetConsoleLogs(input: unknown) {
  const { types } = toolInputSchemas.browserGetConsoleLogs.parse(input);
  const playwrightTypes = types.map((t) => TYPE_MAP[t] ?? t);
  const logs = getConsoleLogs().filter((log) =>
    playwrightTypes.includes(log.type),
  );
  clearConsoleLogs();
  return { logs };
}

import type { Command } from "./types";
import { getAllCommands } from "./commands";

export function getFilteredCommands(query: string): Command[] {
  const all = getAllCommands();
  if (query.length === 0) return all;
  return all.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(query.toLowerCase()),
  );
}

import type { Command } from "./types";
import { getAllCommands } from "./commands";

export function getFilteredCommands(query: string): Command[] {
  const all = getAllCommands();
  if (query.length === 0) return all;

  const q = query.toLowerCase();
  return all.filter((cmd) => {
    const names = [cmd.name, ...(cmd.aliases ?? [])];
    return names.some((name) => {
      const n = name.toLowerCase();
      return n.startsWith(q) || n.includes(q);
    });
  });
}

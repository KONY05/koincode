const BOUNDARY_ROLES = new Set(["clear_boundary", "compact_boundary"]);

/** Returns the index of the last clear/compact boundary in a DB message records array, or -1 if none. */
export function getLastBoundaryIndex(records: Array<{ role: string }>): number {
  for (let i = records.length - 1; i >= 0; i--) {
    if (BOUNDARY_ROLES.has(records[i]?.role ?? "")) return i;
  }
  return -1;
}

export function getTime(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const logger = {
  info(...args: unknown[]) {
    console.log(`[${getTime()}]`, ...args);
  },
  error(...args: unknown[]) {
    console.error(`[${getTime()}]`, ...args);
  },
  warn(...args: unknown[]) {
    console.warn(`[${getTime()}]`, ...args);
  },
};
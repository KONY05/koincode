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
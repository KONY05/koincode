export function getTime(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
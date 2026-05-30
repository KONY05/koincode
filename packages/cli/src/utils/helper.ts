import { execSync } from "node:child_process";
import { homedir } from "node:os";

export const CWD = process.cwd().replace(homedir(), "~");

export function getGitBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
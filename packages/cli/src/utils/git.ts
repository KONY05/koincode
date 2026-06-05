import { runShellCommand } from "../tools/shell";

/**
 * Get list of changed files from git diff.
 * Returns null if not in a git repository or git is not available.
 */
export async function getGitChangedFiles(): Promise<string[] | null> {
  try {
    const result = await runShellCommand({
      command: "git diff --name-only",
      timeout: 5000,
    });

    if (result.exitCode !== 0) {
      return null;
    }

    const files = result.stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    return files.length > 0 ? files : null;
  } catch (_error) {
    // Git not available or not in a git repository
    return null;
  }
}

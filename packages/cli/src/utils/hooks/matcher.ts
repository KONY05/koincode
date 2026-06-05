/**
 * Matcher pattern matching for hooks
 * Supports exact match, OR patterns, wildcards, and negation
 */

/**
 * Check if a tool name matches a matcher pattern
 * @param toolName - The tool name to check (e.g., "Edit", "Write", "Bash")
 * @param matcher - The matcher pattern (e.g., "Edit|Write", "*", "!Bash")
 * @returns true if the tool name matches the pattern
 */
export function matchHook(toolName: string, matcher: string): boolean {
  // Handle negation patterns
  if (matcher.startsWith("!")) {
    const negatedPattern = matcher.slice(1);
    return !matchHook(toolName, negatedPattern);
  }

  // Handle wildcard
  if (matcher === "*") {
    return true;
  }

  // Handle OR patterns (e.g., "Edit|Write")
  if (matcher.includes("|")) {
    const patterns = matcher.split("|");
    return patterns.some((pattern) => matchHook(toolName, pattern.trim()));
  }

  // Handle glob patterns for file paths (e.g., "*.ts")
  if (matcher.includes("*")) {
    return globMatch(toolName, matcher);
  }

  // Exact match
  return toolName === matcher;
}

/**
 * Simple glob pattern matching
 * @param str - The string to match
 * @param pattern - The glob pattern (e.g., "*.ts", "file_*.txt")
 * @returns true if the string matches the pattern
 */
function globMatch(str: string, pattern: string): boolean {
  // Escape special regex characters except *
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

export type BuiltinSkill = {
  name: string;
  description: string;
  tools: string[];
  content: string;
};

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "code-review",
    description: "Review code for bugs, style, and missed edge cases",
    tools: ["readFile", "glob", "grep"],
    content: `---
name: code-review
description: Review code for bugs, style, and missed edge cases
tools: [readFile, glob, grep]
scope: global
---

# Instructions

Perform a thorough code review. Identify bugs, logical errors, edge cases, security issues, and style violations. Do not fix anything — report findings only.

## Steps

1. Read the files specified by the user. If none are specified, ask which files or directories to review.
2. For each file, look for:
   - Logic errors or off-by-one bugs
   - Unhandled edge cases (nulls, empty arrays, out-of-range inputs)
   - Security vulnerabilities (injection, path traversal, exposed secrets)
   - Style inconsistencies with the surrounding code
   - Dead code or unnecessary complexity
3. Present findings grouped by severity: **Critical**, **Warning**, **Suggestion**
4. Keep each finding concise: file, line (if applicable), issue, why it matters

## Notes

- Do not make changes. Report only.
- If no files are specified, ask the user which files or directories to review.`,
  },
  {
    name: "git-commit",
    description: "Stage changes and create a well-structured git commit",
    tools: ["shell", "readFile"],
    content: `---
name: git-commit
description: Stage changes and create a well-structured git commit
tools: [shell, readFile]
scope: global
---

# Instructions

Create a git commit for the user's current changes.

## Steps

1. Run \`git status\` and \`git diff\` to understand all staged and unstaged changes
2. Review the diff to understand what changed and why
3. Stage the relevant files with \`git add <files>\` — avoid \`git add .\` to prevent accidental staging of sensitive files
4. Write a commit message:
   - Subject line: imperative mood, under 72 characters, no trailing period
   - Body (optional): explains *why* the change was made, not what
5. Create the commit: \`git commit -m "subject"\`

## Notes

- Never commit files that likely contain secrets (.env, credentials.json)
- Use conventional commits format when the project already uses it (feat:, fix:, chore:, etc.)
- If changes span multiple unrelated concerns, ask the user if they want to split into multiple commits
- Do not force-push or amend published commits without explicit user approval`,
  },
];

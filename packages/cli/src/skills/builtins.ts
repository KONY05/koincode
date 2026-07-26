export type BuiltinSkill = {
  name: string;
  description: string;
  tools: string[];
  aliases?: string[];
  content: string;
};

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "code-review",
    description: "Delegate a code review to an independent sub-agent for bugs, style, and missed edge cases",
    tools: ["spawnAgent", "checkAgentTask"],
    aliases: ["review"],
    content: `---
name: code-review
description: Delegate a code review to an independent sub-agent for bugs, style, and missed edge cases
tools: [spawnAgent, checkAgentTask]
aliases: [review]
scope: global
---

# Instructions

Perform a thorough code review by delegating the actual review to a sub-agent via spawnAgent, instead of reading and reviewing the code yourself in this conversation. A sub-agent reviewing with no memory of how the code was written or discussed catches things an agent reviewing its own (or its own conversation's) work tends to miss, and its PLAN starting mode makes "do not modify anything" an actual guarantee instead of just an instruction it could ignore.

## Steps

1. Figure out what to review. If the user didn't specify files/directories, ask. If they refer to something contextually ("the file I just edited", "my changes") — resolve that yourself from this conversation first and pass an explicit path (or \`git diff\` scope) into the sub-agent's task, since the sub-agent starts with zero knowledge of this conversation and cannot resolve a vague reference on its own.
2. Call spawnAgent with:
   - \`task\`: the full review brief (see below) — this is the *only* thing the sub-agent will know about what to do, so it must be completely self-contained, not a short pointer.
   - \`startingMode: "PLAN"\` (the default — don't override to BUILD, that removes the write guarantee this whole approach exists for)
   - \`maxTurns\`: scale with scope — a handful of small files needs far fewer turns than a whole directory; err on the higher side (up to the tool's own cap) rather than cutting it off mid-review
   - Leave \`runInBackground\` unset (synchronous) for a normal review the user is waiting on; only set it \`true\` if the user explicitly wants to keep working while a large review runs, in which case follow up with checkAgentTask
3. The \`task\` string must include, in full (the sub-agent has no other source for this):
   - Exactly what to review (the resolved paths/scope from step 1)
   - What to look for: logic errors or off-by-one bugs; unhandled edge cases (nulls, empty arrays, out-of-range inputs); security vulnerabilities (injection, path traversal, exposed secrets); style inconsistencies with the surrounding code; dead code or unnecessary complexity
   - That this is read-only — report findings, do not modify anything
   - The output shape: findings grouped by severity (Critical, Warning, Suggestion), each one concise (file, issue, why it matters)
   - An instruction to quote the actual line of code (or a short snippet) for each finding, not just a line number — line numbers reported back through this path are not reliable, quoted code is
4. Present the sub-agent's findings to the user. If its result mentions a timeout, a step limit, or files it couldn't find or access, relay that honestly rather than presenting a partial or failed review as if it were complete.

## Notes

- Do not make changes yourself, and the sub-agent's PLAN mode means it structurally cannot either — this isn't just a request, it's enforced by which tools are available to it.
- If no files are specified, ask the user which files or directories to review before spawning anything.
- If changes span clearly unrelated concerns (e.g. two unrelated features), consider reviewing them as separate spawnAgent calls so each result stays focused, rather than one call covering everything.`,
  },
  {
    name: "git-commit",
    description: "Stage changes and create a well-structured git commit",
    tools: ["shell", "readFile"],
    aliases: ["commit"],
    content: `---
name: git-commit
description: Stage changes and create a well-structured git commit
tools: [shell, readFile]
aliases: [commit]
scope: global
---

# Instructions

Create a git commit for the user's current changes.

## Steps

1. Run \`git status\` and \`git diff\` to understand all staged and unstaged changes
2. Run \`git log --oneline -10\` and look at a couple of the actual commits (not just subjects) to learn this repo's real conventions before writing anything — prefix style (conventional commits like feat:/fix:/chore:, or something else, or none), whether bodies are used and in what form, capitalization, punctuation. Match what you find, don't default to a generic style you'd use for any repo.
3. Review the diff to understand what changed and why
4. Stage the relevant files with \`git add <files>\` — avoid \`git add .\` to prevent accidental staging of sensitive files
5. Write a commit message consistent with the convention found in step 2:
   - Subject line: imperative mood, under 72 characters, no trailing period
   - Body (optional): explains *why* the change was made, not what
6. Show the commit message to the user and ask literally: "Commit with this message? (yes / edit / cancel)"
7. STOP HERE. This is a hard stop, not a suggestion: end your turn immediately after asking in step 6. Do not call \`git commit\`, do not run any further tool calls, and do not continue to step 8 within this same turn — not even if the changes look small, obviously correct, or the answer seems predictable. Staging the files is as far as you go without a new message from the user. Wait for their next message before doing anything else.
8. Once the user's next message actually answers the question in step 6:
   - If they approve (e.g. "yes"): create the commit — \`git commit -m "subject"\`
   - If they ask for changes: revise the commit message, then return to step 6 and stop again — do not commit the revised message without asking the same way
   - If they cancel: stop without committing, staged files stay staged

## Notes

- Never commit files that likely contain secrets (.env, credentials.json)
- If changes span multiple unrelated concerns, ask the user if they want to split into multiple commits
- Do not force-push or amend published commits without explicit user approval
- Do not push after committing unless the user separately asks you to`,
  },
  {
    name: "init",
    description: "Scaffold an AGENTS.md file for this repo, researching CLAUDE.md or the codebase if needed",
    tools: ["readFile", "listDirectory", "glob", "grep", "writeFile", "switchMode"],
    content: `---
name: init
description: Scaffold an AGENTS.md file for this repo, researching CLAUDE.md or the codebase if needed
tools: [readFile, listDirectory, glob, grep, writeFile, switchMode]
scope: global
---

# Instructions

Scaffold an AGENTS.md file at the root of the current project — the shared convention many coding agents (not just this one) read for project context. Only ever write AGENTS.md. Never create, edit, or overwrite CLAUDE.md.

## Steps

1. Check whether AGENTS.md already exists at the project root (use listDirectory or glob — do not guess). If it exists, tell the user it's already present and stop. Do not overwrite it.
2. If AGENTS.md is missing, check whether a CLAUDE.md exists at the project root with real (non-empty) content.
   - If your system prompt's "Project Instructions" section already shows CLAUDE.md's content (it does whenever AGENTS.md is absent), use that content directly — do not re-read the file. Adapt it into AGENTS.md: rewrite anything specific to Claude Code (tool names, "Claude Code" branding, references to claude.ai) into tool-agnostic language any coding agent could follow. Adapt means condense to the essentials, not transcribe — see the length rules below, they apply here too.
   - If CLAUDE.md doesn't exist, or exists but is empty or whitespace-only, skip this and research instead (step 3).
3. Research the repo before writing anything: read the package manifest(s) (package.json, pyproject.toml, Cargo.toml, etc.), the top-level directory structure, any existing README or docs, and a handful of representative source files. Base every section on what you actually find — do not invent commands, architecture, or conventions that aren't evidenced in the repo.
4. Draft AGENTS.md content. Every one of these is required if the repo actually has it — do not silently drop one for brevity, and do not fabricate one if the repo doesn't have it:
   - A short project overview.
   - How the repo is organized (packages/modules and their responsibilities).
   - The commands to install/run/build/test it.
   - Any hard ownership/boundary rules between parts of the codebase (e.g. "package X must never import from package Y," a documented module-boundary convention) — check code-standards-style docs and existing config (linter boundary rules, workspace structure) for these, don't only rely on prose you happen to have read.
   - Any files or directories explicitly called out elsewhere in the repo (existing docs, comments) as generated, vendored, or otherwise not to be hand-edited.
   Keep every section to the essentials — see the length rules below; essentials means terse, not omitted.
5. If the current mode is PLAN, switch to BUILD before writing (switchMode) — writing a file requires BUILD mode.
6. Write the file to AGENTS.md at the project root.

## Accuracy rules (important)

Every specific claim you write — a command, a file path, a directory listing, which database/library is actually in use — must trace back to something you directly observed in this pass: an actual package.json scripts block, an actual directory listing, an actual config/schema file. Do not state a command exists because it sounds plausible, and do not carry a specific claim over from CLAUDE.md or another context/docs file without confirming it against the real repo first.

- This applies just as much to the CLAUDE.md-mirroring path (step 2) as to fresh research — mirroring the structure and substance of CLAUDE.md is not the same as trusting every concrete detail in it. CLAUDE.md itself can contain stale file paths, renamed files, or outdated commands. Before writing, spot-check every concrete path and command CLAUDE.md's content names (entry points, specific file/directory names, CLI commands) against an actual glob/listDirectory/readFile of this repo, and correct or drop anything that no longer matches — don't transcribe a wrong path just because it's the one already written down.

- Other docs in the repo (README, context/*.md, CLAUDE.md) can themselves be stale or describe planned/target state rather than what's actually implemented — a doc saying a migration or rewrite is "planned" or already "in progress" means the code may not match yet. When a doc's description and what you actually find in the source disagree, trust what you found in the source, not the doc's wording.
- Never list a command in the "commands to run it" section unless you saw it verbatim in a real scripts block (package.json, Makefile, etc.) — do not assume a common command (build/test/lint) exists just because most projects have one.
- Never list a file or directory path you didn't see in an actual listing or read — a plausible-sounding path is still wrong if it doesn't exist.
- When merging information gathered from more than one source (e.g. a manifest plus a docs file plus a directory listing), deduplicate before writing — don't let the same item appear twice in one list because it showed up in two places you looked.
- Do not fill in a detail from general knowledge of what's typical for a project like this one — the library you'd expect for this kind of app, the "usual" way credentials or config are typically stored, the flag or subcommand a familiar tool would normally use. A guess that's reasonable in general is still wrong about this specific repo if you didn't confirm it here, and this applies in any language or stack, not just JavaScript/TypeScript. If you haven't actually read evidence of something (a dependency in a manifest, a flag in real source, a behavior in real code), leave it out rather than writing the plausible default.
- Before writing the file, reread your own draft for internal contradictions, not just contradictions with the repo — e.g. one section saying package/file A owns some responsibility while another section attributes that same responsibility to package/file B, or a summary section stating something a detail section elsewhere in the same draft states differently. Two sections of one AGENTS.md disagreeing with each other is a defect even if one of them happens to be correct.
- Naming any specific database engine, ORM, framework, or major library as something the project uses is one of the easiest places to substitute a well-known or trendy choice for the real one. Never name one without having seen its literal package name in a manifest (package.json's dependencies, requirements.txt, Cargo.toml, etc.) or a matching import in real source during this pass — not because it's a common pairing with the rest of the stack, not because a similar project would typically use it.
- Before labeling any file "generated" / "do not hand-edit," have actual evidence: a build script you read that writes to that exact path, or a gitignore entry covering it. A file merely being named like an artifact (ends in a build-tool extension, sits in a bin- or dist-sounding location, has "wrapper" or "generated" in its name) is not evidence — check whether it's committed source with real edit history before calling it generated, and if you're not sure, leave it off the list rather than guessing.

## Length rules (important)

AGENTS.md is not a reference manual — it is injected into your own system prompt on *every single turn* of every future session in this repo, not read on demand. Every extra line is a recurring token cost paid forever, and content past roughly 10,000 characters gets silently truncated mid-file when loaded, so an oversized file is actively harmful, not just wasteful.

- Target well under that ceiling — roughly 100–150 lines / 4,000–6,000 characters for most repos. If mirroring an existing CLAUDE.md, stay close to that file's own length; do not let AGENTS.md end up longer than the CLAUDE.md it was based on.
- If CLAUDE.md (or your own research) points to other docs instead of inlining them (e.g. "read context/x.md before implementing"), keep that as a pointer in AGENTS.md too — do not expand those files' full contents into new sections. Copying in material a source file only references, rather than contains, is the most common way this balloons.
- Prefer short bullet points and one-line file/path references over prose paragraphs or full code blocks.
- Include only what a future agent needs to get the first turn right: what the project is, how it's organized, how to run/build/test it, and any hard rules (package boundaries, protected files, conventions that aren't obvious from reading the code). Leave out anything a readFile/glob in the moment would recover just as easily.

## Notes

- Never modify, regenerate, or delete an existing CLAUDE.md — it belongs to a different tool's convention and is out of scope here.
- Never overwrite an existing AGENTS.md without being explicitly asked to.
- Only scaffold the primary project root, not every configured workspace root.
- Do not fabricate content — every claim in the generated file should trace back to something actually observed in the repo (or, in the CLAUDE.md-mirroring path, to CLAUDE.md's actual content).`,
  },
];

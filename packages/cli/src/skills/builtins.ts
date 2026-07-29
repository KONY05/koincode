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
  {
    name: "project-init",
    description:
      "Scaffold AGENTS.md (or CLAUDE.md if already established) and the full context/ directory (project-overview, code-standards, ai-workflow-rules, progress-tracker) for a new or existing project",
    tools: ["readFile", "listDirectory", "glob", "grep", "shell", "writeFile", "switchMode"],
    aliases: ["init"],
    content: `---
name: project-init
description: Scaffold AGENTS.md (or CLAUDE.md if already established) and the full context/ directory (project-overview, code-standards, ai-workflow-rules, progress-tracker) for a new or existing project
tools: [readFile, listDirectory, glob, grep, shell, writeFile, switchMode]
aliases: [init]
scope: global
---

# Instructions

Set up the full context-documentation scaffold for this project: five or six files (depending on Step 2's decision) that give any AI agent (and future contributors) a complete, accurate picture of it. AGENTS.md is the default primary file — this tool is KOINCODE, so it should not default to a vendor-specific file as the source of truth (e.g. CLAUDE.md). CLAUDE.md is only written when the repo already established that convention before this skill ran.

## Step 1 — Analyze the codebase

Before writing anything, gather the facts you need:

- Read the package manifest (package.json, pyproject.toml, Cargo.toml, go.mod, etc.) for the project name, scripts, dependencies, and package manager.
- Read README.md if it exists.
- Run \`git log --oneline -20\` (shell) to see what has actually been built so far.
- Use listDirectory / glob to understand the top-level structure — do not guess it.
- Check for existing target files: CLAUDE.md, AGENTS.md, context/project-overview.md, context/code-standards.md, context/ai-workflow-rules.md, context/progress-tracker.md. If any already exist, read them so you update them with real changes rather than overwriting blindly — preserve anything still accurate, and only rewrite the parts that have drifted from what you observe in the repo now.

## Step 2 — Decide which file is primary

- If CLAUDE.md already exists at the project root with real (non-empty) content, it stays primary — a Claude Code convention is already established in this repo, and this skill should not fight that. Write/update CLAUDE.md as the full file (template below), and write/update AGENTS.md as a short pointer stub to it.
- Otherwise — CLAUDE.md is absent, regardless of whether AGENTS.md exists — AGENTS.md is primary. Write/update AGENTS.md as the full file (template below). Do not create CLAUDE.md.
- This matches the standalone \`init\` skill's own stance: never create a CLAUDE.md that didn't already exist, and treat AGENTS.md as the shared, vendor-neutral convention multiple agents (not just this one) read.
- If AGENTS.md already exists purely as a pointer stub (e.g. it says "maintained in CLAUDE.md") but CLAUDE.md does not actually exist, that's a broken/stale state — treat AGENTS.md as primary and replace the stub with the full template.

## Step 3 — Ask one clarifying question if needed

If the project's purpose isn't clear from the code and README alone, ask the user one focused question: "What is this project and what is the core user flow?" Do not ask more than one question, and skip this step entirely if the purpose is already obvious from what you read in Step 1.

## Step 4 — Generate the files

Create the context/ directory if it doesn't exist. If the current mode is PLAN, switch to BUILD (switchMode) before writing — writing files requires BUILD mode. Always write the four context/*.md files. Then, per Step 2's decision: write the primary file (CLAUDE.md or AGENTS.md) using the Primary file template, and — only when CLAUDE.md was selected as primary — also write AGENTS.md using the Pointer file template. Use the structures below as templates — the bracketed placeholders describe what belongs in each section, not literal text to copy in.

---

### context/project-overview.md

\`\`\`
# <Project Name>

## Overview
<2-3 sentence plain-English description of what the product is and who uses it.>

## Goals
<Numbered list of 4-8 product goals.>

## Core User Flow
<Numbered step-by-step description of the primary user journey from start to finish.>

## Features
<Subsections per major feature area. Each subsection has a short heading and bullet points.>

## Scope

### In Scope
<Bullet list of what is explicitly included.>

### Out of Scope
<Bullet list of what is explicitly excluded.>

## Success Criteria
<Numbered list of observable outcomes that confirm the product works.>
\`\`\`

---

### context/code-standards.md

\`\`\`
# Code Standards

## General
<3-6 project-wide rules about module size, error handling philosophy, and system boundaries.>

## <Primary language, e.g. TypeScript>
<4-6 language-specific rules. Type system preferences, validation approach, etc.>

## <Primary framework or runtime, e.g. Hono Server / Next.js / CLI>
<4-6 framework-specific rules for how to structure handlers, components, or commands.>

## <Any additional concern, e.g. Tool Contracts / Styling / Data>
<Rules specific to that concern.>

## File Organization
<Bullet list of key directories and their single responsibility.>
\`\`\`

---

### context/ai-workflow-rules.md

\`\`\`
# AI Workflow Rules

## Approach
<2-3 sentences on the spec-driven, incremental build philosophy.>

## Scoping Rules
<3-5 rules on working one feature at a time.>

## When To Split Work
<Bullet list of signals that a step is too large and should be split.>

## Handling Missing Requirements
<3-4 rules on what to do when requirements are ambiguous or missing.>

## Package / Module Boundaries
<Per-module responsibility rules. Do not reach across defined boundaries.>

## Protected Foundation Components
<List generated or third-party files that must not be modified without explicit instruction.>

## Keeping Docs In Sync
<Rules for updating context files when implementation diverges from the spec.>

## Before Moving To The Next Feature
<Numbered checklist of exit criteria for each feature unit.>
\`\`\`

---

### context/progress-tracker.md

\`\`\`
# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase
- <Phase name and status>

## Current Goal
- <Next feature to implement>

## Completed
<List of completed features, each with a one-sentence description of what was built.>

## In Progress
- <Feature name, or "None.">

## Next Up
<Bullet list of upcoming features in priority order.>

## Open Questions
- <Any unresolved decisions, or "None.">

## Architecture Decisions
<Bullet list of non-obvious decisions and why they were made.>

## Session Notes
<Key library versions, environment quirks, or warnings future sessions should know.>
\`\`\`

---

### Primary file — write as CLAUDE.md if Step 2 selected it, otherwise write as AGENTS.md

\`\`\`
# <CLAUDE.md or AGENTS.md — match whichever filename you are writing>

<Opening line — pick the one matching the filename above, do not include both:>
<If writing CLAUDE.md: "This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.">
<If writing AGENTS.md: "This file provides guidance to AI coding agents working in this repository.">

## Application Building Context

Read the following files in order before implementing or making any architectural decision:

1. \`context/project-overview.md\` — product definition, goals, features, and scope
2. \`context/code-standards.md\` — implementation rules and conventions
3. \`context/ai-workflow-rules.md\` — development workflow, scoping rules, and delivery approach
4. \`context/progress-tracker.md\` — current phase, completed work, open questions, and next steps

Update \`context/progress-tracker.md\` after each meaningful implementation change.

If implementation changes the architecture, scope, or standards documented in the context files, update the relevant file before continuing.

## What This Is
<One paragraph description of the product.>

## Monorepo / Package Structure
<Table or bullet list of packages/apps and their purpose. Omit if single-package.>

## Commands
<Code block of the essential dev, build, test, and database commands.>

## Environment Setup
<Code block listing required environment variables with brief comments.>

## Architecture
<Subsections per major layer (CLI, server, database, shared). Each subsection is a short bullet list of the entry point and key files.>

## Key Design Decisions
<Bullet list of 3-5 non-obvious decisions baked into the architecture.>
\`\`\`

---

### Pointer file — only write this, as AGENTS.md, when Step 2 selected CLAUDE.md as primary. Skip entirely when AGENTS.md is primary — there is nothing to point to.

\`\`\`
# AGENTS.md

This project's agent instructions are maintained in [CLAUDE.md](./CLAUDE.md).

If you are an AI agent other than Claude Code, read \`CLAUDE.md\` for codebase guidance — commands, architecture, environment setup, and key design decisions all live there.
\`\`\`

## Accuracy rules (important)

Every specific claim — a command, a file path, a directory listing, which database/library is actually in use — must trace back to something you directly observed in Step 1: an actual scripts block, an actual directory listing, an actual config/schema file. Do not state a command exists because it sounds plausible for a project like this one. When updating existing files rather than creating fresh ones, re-verify their concrete claims against the current repo too — an existing doc can already be stale.

## Step 5 — Confirm and report

After writing all files, report back with:
- Which file is primary (CLAUDE.md or AGENTS.md) and why — an existing CLAUDE.md found in Step 2, versus the AGENTS.md default
- Which files were created vs. updated
- Any assumptions you made that the user should verify
- Any open questions you added to progress-tracker.md because the answer wasn't clear from the code

## Notes

- Never create a CLAUDE.md that didn't already exist — AGENTS.md is this skill's default primary file, precisely because this tool isn't vendor-specific and shouldn't default to a vendor-specific filename as the source of truth.
- If CLAUDE.md already exists, don't remove, rename, or demote it — keep it primary and keep AGENTS.md as its pointer, consistent with whatever convention this repo already established.
- Do not fabricate content — every claim in every generated file should trace back to something actually observed in the repo during this pass.`,
  },
];

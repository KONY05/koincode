# AI Workflow Rules

## Approach

Build this project incrementally using a spec-driven workflow. Context files define what to build, how to build it, and what the current state of progress is. Always implement against these specs — do not infer or invent behavior from scratch.

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine changes across unrelated packages in a single implementation step.

## When To Split Work

Split an implementation step if it combines:

- CLI UI changes and server-side AI orchestration changes
- Schema changes and unrelated feature work
- Multiple unrelated route handlers or tool definitions
- Behavior that is not clearly defined in the context files

If a change cannot be verified end to end quickly, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior that is not defined in the context files.
- If a requirement is ambiguous, resolve it in the relevant context file before implementing.
- If a requirement is missing, add it as an open question in `progress-tracker.md` before continuing.

## Package Boundaries

Respect the responsibilities of each package and do not reach across them:

- `@koincode/cli` — terminal UI and local tool execution only; no direct DB access, no AI SDK calls
- `@koincode/server` — AI orchestration only; no filesystem access, no tool execution
- `@koincode/shared` — contracts only; no runtime dependencies on CLI or server internals
- `@koincode/database` — schema and generated client only; no business logic

If a change requires touching more than two packages, verify the design against `project-overview.md` before proceeding.

## Protected Foundation Components

Do not modify OpenTUI primitives or Prisma-generated client files unless explicitly instructed.

This includes:

- `packages/database/src/generated/*` (Prisma generated client)
- OpenTUI internal layout primitives consumed from the library

Project-specific UI, layout, and feature logic must be implemented in app-level components and screens rather than modifying these foundations.

## Keeping Docs In Sync

Update the relevant context file whenever implementation changes:

- System architecture or package boundaries → `project-overview.md`
- Storage model or schema decisions → `project-overview.md` and `code-standards.md`
- Code conventions or standards → `code-standards.md`
- Feature scope or open questions → `progress-tracker.md`

Progress state must reflect the actual state of the implementation, not the intended state.

## Before Moving To The Next Feature

1. The current feature works end to end within its defined scope.
2. No package boundary defined in `project-overview.md` was violated.
3. `progress-tracker.md` reflects the completed work and the next feature is updated.

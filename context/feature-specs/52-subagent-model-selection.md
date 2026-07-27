while discussing sub-agent findings accuracy (feature 51), the question came up: for spawnAgent, do we use the exact model the user is currently using, or a smaller curated set of models per provider for sub-agent tasks?

## Current behavior

Always inherits the exact parent model — no separate "sub-agent model" concept exists anywhere in the schema. `packages/cli/src/hooks/use-chat.ts:432` reads `const model = metadata?.model ?? FALLBACK_MODEL_ID` off the current turn's message metadata and passes it straight into `runSpawnAgent` unchanged, at both call sites (foreground and `runInBackground`). `toolInputSchemas.spawnAgent` (`packages/shared/src/schemas.ts:140-177`) has no `model` field the calling model (or the user) can override per call.

## Discussion

Considered whether KOINCODE should maintain a curated "good enough for exploration" model per provider (cheaper/faster than whatever the user picked, e.g. a haiku/mini/flash tier) and route sub-agents to it automatically.

Leaning against baking that in ourselves, for reasons specific to this app's BYOK model:
- Users pay their own provider bill directly (no KOINCODE billing layer) — quietly downgrading a sub-agent to a model we chose changes what their key gets billed against without their say.
- Would require maintaining and keeping correct a capability-tier mapping across every provider in `packages/shared/src/models.ts`, including OpenRouter and local/Ollama models, where "the cheap one" isn't obvious or may not exist.
- The model registry has no capability-tier metadata today (only pricing/context/vision flags) — this would be new surface area to keep accurate as models change.

The real tradeoff worth solving: if a session is driven by an expensive/slow reasoning model, every parallel `spawnAgent` exploration burns that same rate, which compounds fast on a multi-question delegation burst (now more likely given `51-enforcing-code-exploration.md`'s stricter delegation requirement).

Leaning toward: keep parent-model inheritance as the default, but add an optional user-configurable override (e.g. `subagentModel` in `~/.koincode/config.json`'s `KoincodeGlobalConfig`) that `runSpawnAgent`'s callers check before falling back to the inherited parent model. Opt-in, user-controlled, no app-authored heuristic to maintain.

## Decision

Matched the existing one-command-per-setting convention (`/models`, `/effort`, `/setup`) rather than inventing a new UX pattern or a config-file-only setting: a `/subagent-model` command opens the same `ModelsDialogContent` picker `/models` already uses, with an extra "Inherit from session (default)" entry prepended to the frontier tab so going back to the default is a normal list selection, not a special gesture. Global config only (`KoincodeGlobalConfig.subagentModel`), same as `defaultModel` — no per-session scope, consistent with every other persisted setting in this app (the one precedent for session-only state, `incognito`, is intentionally unpersisted for reasons specific to that feature, not a general pattern to follow here).

Resolution order at spawn time: configured `subagentModel` override, if set, wins outright — otherwise inherit the session's current model from message metadata, same as before this change. Validity of a saved override is checked the same way `resolveInitialModel` already checks `defaultModel` (`findSupportedChatModel` or `isCustomOrOllamaModelId`) — a stale/deleted custom model id falls back to `null` (inherit) rather than silently breaking sub-agent spawns. Did not add key-presence checking on top of that (the open question from the Discussion section) — a configured-but-unkeyed override surfaces the same way an unkeyed model choice already does anywhere else in the app (a clear error from the server's model resolver), not a silent fallback; scoped out as unnecessary special-casing rather than deferred.

## Status

Implemented.
- `packages/shared/src/config.ts`: `KoincodeGlobalConfig.subagentModel?: string`.
- `packages/cli/src/utils/configs/global-config.ts`: `updateGlobalConfig` handles `subagentModel`, following the exact `defaultModel` convention (`""` clears the field).
- `packages/cli/src/providers/prompt-config/index.tsx`: `resolveInitialSubagentModel()` (validity-checked, same pattern as `resolveInitialModel`), `subagentModel`/`subagentModelDisplayName` state, `setSubagentModel`, all exposed on `PromptConfigContextValue`.
- `packages/cli/src/components/dialogs/models-dialog.tsx`: new optional `inheritOption` prop on `ModelsDialogContent` — prepends a selectable `FrontierRow` (`{ kind: "inherit" } | { kind: "model"; model }`) to the frontier tab's list when passed, participating in the same arrow-key/search/mouse list as every other row (no new interaction pattern). `/models` itself passes no `inheritOption`, so its behavior is unchanged.
- `packages/cli/src/components/command-menu/commands.tsx`: new `/subagent-model` command, title showing the current resolved value, reusing `ModelsDialogContent` with the inherit entry wired to `setSubagentModel(null)`.
- `packages/cli/src/components/command-menu/types.ts` / `packages/cli/src/components/input-bar.tsx`: `subagentModel`/`subagentModelDisplayName`/`setSubagentModel` threaded through `CommandContext`.
- `packages/cli/src/hooks/use-chat.ts`: both `spawnAgent` dispatch sites (foreground and `runInBackground`) now resolve `subagentModel ?? metadata?.model ?? FALLBACK_MODEL_ID` instead of always inheriting the parent model unconditionally.
- `bun run typecheck` (all four packages) and `bun run lint` clean.
- **Not verified live** — no real TTY session in this environment to confirm the `/subagent-model` dialog renders/selects correctly or that a configured override actually reaches a spawned sub-agent.

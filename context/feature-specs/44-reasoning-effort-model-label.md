i was thinking if we should add a label to each model for display purposes to show something finer or so, what do you think — like "Build · GPT-5.5 OpenAI · medium" (mode · model · provider · reasoning effort)?

Corrected twice over the course of this spec:
1. First correction — keep the provider name, don't drop it; reasoning effort isn't OpenAI-only, research it properly across the AI SDK before assuming that.
2. Second, final correction — **no provider name at all**. The line is `Mode › Model display name › reasoning effort`, three segments only. "Model display name" means a new `label` field on each model entry (e.g. `gpt-5.5` → `"GPT-5.5"`, `claude-opus-4-8` → `"Claude Opus 4.8"`) rendered instead of the raw model id string. Reasoning effort is its own field on each model entry containing the enum list of levels that specific model supports.

## Decision

**Part 1** — add a `label: string` field to every entry in `SUPPORTED_CHAT_MODELS`, and render that everywhere a model name is currently shown, instead of the raw id. No provider name anywhere, ever — that idea is fully dropped, not deferred.

**Part 2** — add a `reasoningEffort` field to model entries that support it, containing the enum of levels that specific model accepts (`"low" | "medium" | "high"`, a subset per model), plus a user-facing control to pick one and have it actually reach the AI provider call. This is cross-provider, not OpenAI-specific — see the research below, carried over unchanged from the prior draft of this spec since the correction only affected Part 1.

Combined status bar result: `Build › GPT-5.5 › medium` (effort segment absent entirely for models without a `reasoningEffort` field).

## Research: reasoning effort across the AI SDK (confirms it's not OpenAI-only)

Checked `ai-sdk.dev` provider docs + Vercel AI Gateway reasoning docs directly, against the exact packages this repo has installed (`packages/server/package.json`: `@ai-sdk/anthropic@^3.0.68`, `@ai-sdk/openai@^3.0.52`, `@ai-sdk/google@^3.0.80`, `@ai-sdk/xai@^3.0.99`, `@openrouter/ai-sdk-provider@^2.9.0`).

| Provider | Mechanism | Shape | Notes |
|---|---|---|---|
| **OpenAI** | Native effort levels | `providerOptions.openai.reasoningEffort: 'none'\|'minimal'\|'low'\|'medium'\|'high'\|'xhigh'\|'max'` | Default `'medium'`. "Supported reasoning efforts vary by model" — e.g. GPT-5.6 supports the full set; older gpt-5.x entries may support fewer. Applies to the repo's `gpt-5.6-*`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5-mini`. `gpt-4.1-mini` is not a reasoning model — no effort control. |
| **Anthropic** | Split per model — confirmed against Anthropic's own platform docs, not assumed | Adaptive-only (manual `budgetTokens` now rejected with a 400): `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5` — `thinking: { type: 'adaptive' }, effort`. Dual-support (budget still works but deprecated, adaptive recommended): `claude-sonnet-4-6`. Budget-only, no adaptive at all: `claude-haiku-4-5` — `thinking: { type: 'enabled', budgetTokens: N }`, thinking off by default unless set. | Confirmed per-model (see Decision) — every Anthropic model in the registry ends up supporting the low/medium/high UI control, just via two different mechanisms depending on model. `claude-sonnet-5` notably follows the Opus-4.7+ rules despite the "Sonnet" name — manual thinking is a hard error there, not just deprecated. |
| **Google (Gemini)** | Split by model generation | Gemini 3/3.1: `providerOptions.google.thinkingConfig.thinkingLevel: 'minimal'\|'low'\|'medium'\|'high'` (label-based — direct fit). Gemini 2.5: `thinkingConfig.thinkingBudget: number` (token count, no label) | Repo has both generations: `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview` get `thinkingLevel` directly; `gemini-2.5-flash`, `gemini-2.5-pro` need a low/medium/high → token-count mapping, confirmed per-model against `ai.google.dev/gemini-api/docs/thinking` (see §2d). |
| **xAI (Grok)** | Native effort levels | `providerOptions.xai.reasoningEffort: 'none'\|'low'\|'medium'\|'high'` | Default `'low'`. Confirmed: `grok-4.5` is the only xAI entry in the registry, it's xAI's latest model, and per xAI's docs it supports `reasoningEffort`. |
| **OpenRouter** (both the dedicated `openrouter` provider entries and the fallback path used for every other provider when no direct API key is configured) | Unified normalization layer | `providerOptions.openrouter.reasoning: { effort: 'low'\|'medium'\|'high'\|'xhigh'\|'minimal'\|'none', max_tokens?: number }` | The installed `@openrouter/ai-sdk-provider` normalizes this per underlying model (e.g. maps to Anthropic's `output_config.effort` under the hood). This closes an existing gap: `resolveViaOpenRouter` (`models.ts:98-118`) currently sets **no** thinking/effort options at all, so Anthropic/Google's existing hardcoded thinking silently disappears for anyone without a direct provider key. This feature fixes that as a side effect. |
| **Ollama / custom (OpenAI-compatible)** | None found | — | No reasoning-effort mechanism surfaced in AI SDK docs for either provider path. Segment stays hidden for these, same as today's `isVisionModel`-style "unsupported → false/null" pattern. |

## Design

### Part 1: model display label

**1a. `label` field (`packages/shared/src/models.ts`)**

```ts
type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  contextWindow: number;
  vision: boolean;
  label: string; // required — every model needs a clean display name
};
```

Confirmed values:

| id | label |
|---|---|
| `claude-fable-5` | Claude Fable 5 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-opus-4-7` | Claude Opus 4.7 |
| `claude-sonnet-5` | Claude Sonnet 5 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-haiku-4-5` | Claude Haiku 4.5 |
| `gpt-5.6-sol` | GPT-5.6 Sol |
| `gpt-5.6-terra` | GPT-5.6 Terra |
| `gpt-5.6-luna` | GPT-5.6 Luna |
| `gpt-5.5` | GPT-5.5 |
| `gpt-5.4` | GPT-5.4 |
| `gpt-5.3-codex` | GPT-5.3 Codex |
| `gpt-5-mini` | GPT-5 Mini |
| `gpt-4.1-mini` | GPT-4.1 Mini |
| `gemini-3.5-flash` | Gemini 3.5 Flash |
| `gemini-3-flash-preview` | Gemini 3 Flash (Preview) |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (Preview) |
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `gemini-2.5-pro` | Gemini 2.5 Pro |
| `grok-4.5` | Grok 4.5 |
| `moonshotai/kimi-k3` | Kimi K3 |
| `z-ai/glm-5.2` | GLM 5.2 |
| `meta/muse-spark-1.1` | Muse Spark 1.1 |
| `qwen/qwen3.7-max` | Qwen3.7 Max |
| `minimax/minimax-m3` | MiniMax M3 |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro |
| `moonshotai/kimi-k2.6` | Kimi K2.6 |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash |
| `moonshotai/kimi-k2.7-code` | Kimi K2.7 Code |
| `qwen/qwen3.7-plus` | Qwen3.7 Plus |
| `poolside/laguna-s-2.1:free` | Laguna S 2.1 |
| `tencent/hy3:free` | Hunyuan 3 |
| `cohere/north-mini-code:free` | North Mini Code |
| `google/gemma-4-31b-it:free` | Gemma 4 31B |
| `openai/gpt-oss-120b:free` | GPT-OSS 120B |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Nemotron 3 Ultra |

Made `required` (not optional) since every built-in model should have a clean name — no fallback-to-raw-id case needed for `SUPPORTED_CHAT_MODELS` entries. Ollama and custom models keep their existing raw-name display (they're user-provided strings, not curated registry entries).

**1b. `getModelDisplayName` (`packages/cli/src/lib/custom-models.ts:30-34`)**

Currently:
```ts
export function getModelDisplayName(modelId: string): string {
  if (!modelId.startsWith("custom/")) return modelId;
  const entry = listCustomModels().find((m) => m.id === modelId);
  return entry?.modelId ?? modelId;
}
```
This is the single choke point already consumed by `prompt-config/index.tsx:86` (`modelDisplayName = useMemo(() => getModelDisplayName(model), [model])`) and reused as-is in `bot-message.tsx:588-600` and `background-task-message.tsx:93` (confirmed in earlier research). Update it to check the new `label` field for built-in models before falling through:

```ts
export function getModelDisplayName(modelId: string): string {
  if (modelId.startsWith("custom/")) {
    const entry = listCustomModels().find((m) => m.id === modelId);
    return entry?.modelId ?? modelId;
  }
  return findSupportedChatModel(modelId)?.label ?? modelId;
}
```
Fixing it in this one place propagates the label to the status bar, per-message footers, and anywhere else `modelDisplayName`/`getModelDisplayName` is read — no separate wiring needed in `status-bar.tsx` itself, which already just renders whatever `modelDisplayName` the context hands it.

**1c. Models dialog (`packages/cli/src/components/dialogs/models-dialog.tsx:360-366`)**

Frontier/Free tab rows currently render raw `model.id` directly. Switch to `model.label` (or route through `getModelDisplayName`) so the picker shows the same friendly name the status bar will show once selected — otherwise the id and the post-selection label would visibly mismatch.

No provider name rendered anywhere in this feature — status bar, footers, or dialog.

### Part 2: reasoning effort

**2a. Model capability data (`packages/shared/src/models.ts`)**

```ts
export type ReasoningEffortLevel = "low" | "medium" | "high";

type SupportedChatModelDefinition = {
  // ...id, provider, pricing, contextWindow, vision, label (above)
  reasoningEffort?: readonly ReasoningEffortLevel[]; // which UI levels this model accepts; absent = unsupported
};
```

Populated per the research table above — OpenAI's `gpt-5.x` reasoning line, **every** Anthropic model (all six get `["low","medium","high"]`; which mechanism serves it is a server-side implementation detail, not a UI-visible difference — see §2d), Google's Gemini 3/3.1 *and* 2.5 entries (both generations map to the same three UI labels, just via different provider-option shapes — see §2d), and `grok-4.5`. `gpt-4.1-mini`, Ollama, and custom models get no `reasoningEffort` field.

Helper, mirroring `isVisionModel` (`models.ts:312-315`):
```ts
export function getReasoningEffortLevels(modelId: string): readonly ReasoningEffortLevel[] | null {
  return findSupportedChatModel(modelId)?.reasoningEffort ?? null;
}
```

**2b. Persistence & CLI state**

A flat field on `KoincodeGlobalConfig` (`packages/shared/src/config.ts:128-146`) — `reasoningEffort?: ReasoningEffortLevel` — with a matching block in `updateGlobalConfig` (`packages/cli/src/utils/configs/global-config.ts:52-134`), and `reasoningEffort`/`setReasoningEffort` added to `PromptConfigContextValue` (`packages/cli/src/providers/prompt-config/index.tsx:20-34`), following `setModel`'s exact update pattern (lines 92-96). Re-derive validity against `getReasoningEffortLevels(model)` whenever `model` changes; clear to `null` if the new model doesn't support the currently-set level.

Confirmed flat/global, not remembered per model id — mirrors exactly how `model` itself already works: one global value, switching models re-derives what's valid for the new model (§2b above), and there's no per-session scoping to worry about, same as `model` selection isn't session-scoped today either. A concurrent session changing the model or effort updates the same global config file everyone reads from, consistent with existing behavior.

**2c. Status bar segment (`packages/cli/src/components/status-bar.tsx`)**

Third fixed-priority segment, same shed-lowest-priority-first width logic as `voiceLabel`/`mcpLabel` (lines 87-102): `Build › GPT-5.5 › medium`. Hidden entirely when `getReasoningEffortLevels(model)` is `null`. Since Part 1 adds no provider sub-label, this segment slots in cleanly as a normal third `›`-delimited segment with no extra width-priority complexity.

**2d. Server-side: translating a UI level into the right provider option shape (`packages/server/src/lib/models.ts`)**

Three different provider shapes exist for the same three UI labels — one mapping function per provider, replacing today's hardcoded constants:

```ts
// Confirmed per Anthropic's platform docs: manual budgetTokens is a hard 400 error on these —
// adaptive is the only way to get reasoning depth control at all.
const ANTHROPIC_ADAPTIVE_ONLY = new Set<AnthropicModelId>([
  "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5",
]);
// budgetTokens still works here but is deprecated; adaptive is recommended over it.
const ANTHROPIC_DUAL_SUPPORT = new Set<AnthropicModelId>(["claude-sonnet-4-6"]);
// claude-haiku-4-5: never got the adaptive upgrade — budgetTokens is the only mechanism,
// and thinking is off by default unless it's set explicitly.

const HAIKU_BUDGET_BY_EFFORT: Record<ReasoningEffortLevel, number> = {
  low: 4000,
  medium: 10000, // matches today's existing hardcoded default
  high: 24000,
};

function anthropicEffortOptions(modelId: AnthropicModelId, effort: ReasoningEffortLevel): ProviderOptions {
  if (modelId === "claude-haiku-4-5") {
    return { anthropic: { thinking: { type: "enabled", budgetTokens: HAIKU_BUDGET_BY_EFFORT[effort] } } };
  }
  // Adaptive-only and dual-support models both take the adaptive path —
  // it's recommended even on claude-sonnet-4-6, where the old budget path still works.
  return { anthropic: { thinking: { type: "adaptive" }, effort } };
}

// Confirmed against ai.google.dev/gemini-api/docs/thinking's documented min/max/default per model.
const GEMINI_25_BUDGET_BY_EFFORT: Record<GoogleModelId, Record<ReasoningEffortLevel, number>> = {
  "gemini-2.5-pro": { low: 3000, medium: 9000, high: 28000 },   // range 128–32,768, no full disable
  "gemini-2.5-flash": { low: 500, medium: 9000, high: 22000 },  // range 0–24,576, 0 disables entirely
};

function googleEffortOptions(modelId: GoogleModelId, effort: ReasoningEffortLevel): ProviderOptions {
  const isGemini3Line = modelId.startsWith("gemini-3"); // 3 and 3.1
  return isGemini3Line
    ? { google: { thinkingConfig: { thinkingLevel: effort, includeThoughts: true } } }
    : { google: { thinkingConfig: { thinkingBudget: GEMINI_25_BUDGET_BY_EFFORT[modelId][effort], includeThoughts: true } } };
}

function xaiEffortOptions(effort: ReasoningEffortLevel): ProviderOptions {
  return { xai: { reasoningEffort: effort } };
}

function openaiEffortOptions(effort: ReasoningEffortLevel): ProviderOptions {
  return { openai: { reasoningEffort: effort } };
}

function openrouterEffortOptions(effort: ReasoningEffortLevel): ProviderOptions {
  return { openrouter: { reasoning: { effort } } };
}
```

`resolveChatModel(modelId: string)` (line 284) gains a second optional parameter, `effort?: ReasoningEffortLevel`, threaded down into `resolveAnthropicModel` / `resolveOpenAIModel` / `resolveGoogleModel` / `resolveXaiModel` / `resolveViaOpenRouter`, each applying its own function above only when both an effort was passed *and* the model's `reasoningEffort` list includes it — otherwise falling back to no options (Ollama/custom) or, for Anthropic/Google, to today's existing hardcoded constant as a safe default (a model that supports effort should never end up with *less* reasoning than it has today just because the user hasn't touched the new setting yet). This replaces `ANTHROPIC_THINKING`/`GOOGLE_THINKING` (`models.ts:48-54`) outright as the "effort was chosen" path; they remain only as the pre-choice fallback.

This also fixes `resolveViaOpenRouter` (`models.ts:98-118`), which today sets no `providerOptions` at all — every call site that falls through to it (any provider, when no direct API key is configured) should call `openrouterEffortOptions` when an effort is set, closing the existing silent-drop gap noted in the research table.

**2e. Client → server**

Open item: the exact `/chat` request-body field carrying `model` (`packages/cli/src/hooks/use-chat.ts` / `packages/cli/src/lib/api.ts`) needs tracing before `reasoningEffort` can ride alongside it — not done in this research pass.

**2f. Changing the setting — confirmed: a `/effort` slash command opening a picker dialog**

Not a status-bar click-to-cycle. A new `/effort` command opens a small selection dialog listing the levels the *current* model supports, letting the user pick one — same interaction shape as `ProviderPicker` in `models-dialog.tsx:62-117` (up/down navigate, enter to select, esc to cancel), reused as the structural template for a new `EffortDialogContent` component rather than a bespoke pattern.

- If `getReasoningEffortLevels(model)` is `null` for the current model, the command should short-circuit with a toast (`"This model doesn't support reasoning effort control."`), mirroring the existing "No custom providers yet — run /setup to add one first." guard in `models-dialog.tsx:210-216`, rather than opening an empty/disabled dialog.
- Otherwise, render the model's supported levels (a subset of `low`/`medium`/`high`) as a selectable list, current value pre-highlighted, `onSelect` calling `setReasoningEffort` and closing the dialog.
- Where slash commands are registered/dispatched wasn't traced in this pass (the codebase clearly already has a command system — `/setup`, `/update` are referenced elsewhere) — needs locating before implementation, alongside the existing open item about the `/chat` request body.

## Package boundaries

- **shared**: `models.ts` (`label` field, `ReasoningEffortLevel` type, `reasoningEffort` capability field + helper), `config.ts` (config field).
- **cli**: `custom-models.ts` (`getModelDisplayName` fix), `global-config.ts` (persistence), `prompt-config/index.tsx` (state), `status-bar.tsx` (effort segment, display only), `models-dialog.tsx` (label in list rows), a new `EffortDialogContent` component + wherever the `/effort` command gets registered, request-building code (wherever `/chat` is called from) for sending the effort value.
- **server**: `lib/models.ts` (`resolveChatModel` signature, five per-provider effort-mapping functions, replacing `ANTHROPIC_THINKING`/`GOOGLE_THINKING`), `routes/chat.ts` (pass the value through to `resolveChatModel` — `streamText`/`generateText` themselves don't change, `providerOptions` is already threaded generically at `chat.ts:265` and `chat.ts:447`).

## Suggested implementation order

1. **Part 1 alone first** — `label` field on every `SUPPORTED_CHAT_MODELS` entry, `getModelDisplayName` fix, models-dialog row update. Fully independent of Part 2, ships and is verifiable on its own (visual check across status bar, dialog, per-message footers).
2. `shared`: `ReasoningEffortLevel` type, `reasoningEffort` capability field populated per the (now-confirmed) research table, `getReasoningEffortLevels` helper.
3. `shared`/`cli`: config field + `global-config.ts` block + `prompt-config` state, defaulting/clearing logic.
4. `cli`: status bar effort segment (hardcode a local value first to check layout/truncation before wiring the real setter).
5. `cli`: locate the slash-command registry, add `/effort` + `EffortDialogContent` (modeled on `ProviderPicker`), including the unsupported-model toast guard.
6. Trace the `/chat` request body field for `model`, add `reasoningEffort` alongside it.
7. `server`: the five per-provider effort-mapping functions (including the Anthropic per-model split and the per-model Gemini 2.5 budget table) + `resolveChatModel`'s new parameter, replacing the two existing hardcoded constants as the "effort chosen" path. Verifiable per-provider in isolation: call `/chat` with a given model + effort, confirm the resolved `providerOptions` matches the table above.

## Open questions / deferred

- Confirm each installed AI SDK package version (`@ai-sdk/anthropic@^3.0.68`, `@ai-sdk/google@^3.0.80`, `@ai-sdk/xai@^3.0.99`, `@openrouter/ai-sdk-provider@^2.9.0`) actually resolves to a version that ships the adaptive-effort/`reasoningEffort`/`thinkingLevel` option shapes described above — caret ranges mean the lockfile-resolved version wasn't independently verified.
- Exact client request-body field/path for `model` (`/chat`) → needed before wiring `reasoningEffort` alongside it.
- Where the slash-command registry lives → needed before adding `/effort`.

## Status

Implemented per this spec, both parts:

**Part 1**: `label` field added to every `SUPPORTED_CHAT_MODELS` entry (`packages/shared/src/models.ts`). `getModelDisplayName` (`packages/cli/src/lib/custom-models.ts`) resolves built-in ids through it, propagating to the status bar, message footers, and the models dialog with one change (all read through the same `modelDisplayName`/`getModelDisplayName` choke point, confirmed in the design phase above). No provider name anywhere.

**Part 2**: `/effort` command + `EffortDialogContent` shipped (`packages/cli/src/components/command-menu/commands.tsx`, `packages/cli/src/components/dialogs/effort-dialog.tsx`), modeled on `AgentsDialogContent` rather than `ProviderPicker` (a closer match — a small fixed enum list with a current-value bullet marker, via the existing `DialogSearchList`). Client → server wiring traced and implemented: `/chat` request body's `model` field lives in `use-chat.ts`'s `prepareSendMessagesRequest` (line ~278 pre-implementation); `reasoningEffort` rides alongside it the same way, threaded through `ChatMessageMetadata`, `QueuedMessage`, and `submit()`'s params. Slash commands are registered in `commands.tsx`'s flat `COMMANDS` array (`Command`/`CommandContext` types in `command-menu/types.ts`), dispatched from `input-bar.tsx`'s `handleCommand`. Server schema: `submitSchema.reasoningEffort` (`routes/chat.ts`), `resolveChatModel`'s new second parameter (`lib/models.ts`).

**Correction, prompted by the user after initial implementation shipped**: the first pass modeled every model's reasoning effort as the same fixed three-value set (`low`/`medium`/`high`) — matching the original screenshot, but wrong, since several providers expose finer-grained levels the docs plainly document. Corrected by widening `ReasoningEffortLevel` to `"minimal" | "low" | "medium" | "high" | "xhigh" | "max"` and giving each model its own accurate subset, sourced directly from four `ai-sdk.dev` provider doc pages the user linked (not re-derived from memory):

- **OpenAI**: only GPT-5.6 (`gpt-5.6-sol`/`terra`/`luna`) confirmed to support the full range (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`). Older `gpt-5.5`/`gpt-5.4`/`gpt-5.3-codex`/`gpt-5-mini` kept at the standard three — docs say "varies by model" without naming them, and guessing wrong risks a runtime 400.
- **Anthropic**: `claude-opus-4-7`, `claude-opus-4-8`, `claude-fable-5`, `claude-sonnet-5` confirmed to additionally support `xhigh` beyond low/medium/high. `claude-sonnet-4-6` and `claude-haiku-4-5` kept at the standard three (`sonnet-4-6` in particular: docs describe it as "adaptive" without clearly confirming a manual `effort` dial the way they do for the four `xhigh` models — flagged as still not fully resolved, not silently assumed either way).
- **Google**: Gemini 3 Flash family (`gemini-3.5-flash`, `gemini-3-flash-preview`) confirmed to additionally support `minimal`. Gemini 3.1 Pro (`gemini-3.1-pro-preview`) confirmed capped at low/medium/high, no `minimal`. Both Gemini 2.5 entries unchanged (self-defined token-budget mapping, not a provider-imposed label set).
- **xAI**: `grok-4.5` unchanged — xAI's own `reasoningEffort` ceiling is `high`; no `xhigh`/`max` exists for this provider at all, confirmed.

`none` deliberately excluded from the modeled union everywhere — it means "disable reasoning entirely," a different concept than an effort *level*, and would conflict with this app's existing "reasoning-capable models ship with reasoning on by default" posture.

Mechanically: `HAIKU_BUDGET_BY_EFFORT` and `GEMINI_25_BUDGET_BY_EFFORT` (`packages/server/src/lib/models.ts`) became `Partial<Record<ReasoningEffortLevel, number>>` (with a `?? 10000` fallback) since those two only ever receive three of the six now-possible values — the wider type is enforced at the per-model array level (`getReasoningEffortLevels`/`supportsEffort` gate what a caller can pass), not at every internal lookup table. `EffortDialogContent` gained a small `EFFORT_LABELS` display map (`"xhigh"` → `"Extra High"`, etc.) instead of naive capitalization. `submitSchema.reasoningEffort` (`routes/chat.ts`) widened to match — this one was load-bearing: leaving it at the old three-value `z.enum` would have silently 400'd every request carrying one of the new levels.

Verified via `bun run typecheck` (clean across all four packages). Not yet verified live against real provider accounts — in particular, `claude-sonnet-4-6`'s exact effort support and whether every gpt-5.6 variant truly accepts the full range remain unconfirmed beyond the docs' general statements.

**Follow-up: OpenRouter-native models, researched before committing.** Originally every OpenRouter-native registry entry (10 paid + 6 free) shipped with `reasoningEffort: undefined` — a scope gap, not a confirmed limitation, since that omission was never actually researched (the AI SDK research above only covered OpenRouter as a *fallback* for the four direct-API providers, not OpenRouter's own native model catalog). Asked to research it: OpenRouter's `reasoning.effort` is a unified abstraction — for models without native graduated levels, it computes a `max_tokens` budget from the effort percentage itself (xhigh≈95%, high≈80%, medium≈50%, low≈20%), so the real per-model question is just "is this a reasoning/thinking-capable model at all," not "does it support effort levels specifically."

Researched each entry's real-world model family (these registry ids are fictional future versions, but the underlying families are real and well-documented):

- **Enabled** (`STANDARD_EFFORT_LEVELS`): `openai/gpt-oss-120b:free` (OpenAI's real gpt-oss is a confirmed reasoning model with native low/medium/high — the strongest-confidence entry here), `qwen/qwen3.7-max`, `qwen/qwen3.7-plus` (Qwen3.5+ ships hybrid thinking enabled by default), `z-ai/glm-5.2` (GLM-4.5/4.6 hybrid thinking, enabled by default), `minimax/minimax-m3` (MiniMax M2's confirmed "interleaved thinking"), `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash` (DeepSeek V4 explicitly "supports thinking and non-thinking modes").
- **Left unsupported, with a reason on each entry** (not silently skipped): `moonshotai/kimi-k3`/`kimi-k2.6` (real Kimi K2 splits reasoning into a separate "Kimi K2 **Thinking**" SKU — the base non-"-thinking" line isn't reasoning-branded), `moonshotai/kimi-k2.7-code` (coding-specialized, not reasoning-branded), `tencent/hy3:free` (real Tencent Hunyuan similarly splits out a separate "Hunyuan-**T1**" reasoning model), `nvidia/nemotron-3-ultra-550b-a55b:free` (real Llama-Nemotron *is* reasoning-capable, but the toggle is a **system-prompt convention** — "detailed thinking on/off" — not a structured API parameter; whether OpenRouter's `reasoning.effort` actually reaches that mechanism is unconfirmed, so left off rather than risk a no-op control), `meta/muse-spark-1.1`/`poolside/laguna-s-2.1:free` (no identifiable real-world model to research against), `cohere/north-mini-code:free`/`google/gemma-4-31b-it:free` (no known reasoning/thinking mode for either real family).

No server-side changes needed for this — `resolveViaOpenRouter` (`packages/server/src/lib/models.ts`) already applies `openrouterEffortOptions` generically whenever a model's `reasoningEffort` array includes the requested level, regardless of whether that model's `provider` is natively `"openrouter"` or is falling back there from a direct-API provider. This was purely a registry-data change (`packages/shared/src/models.ts`).

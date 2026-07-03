# Feature Spec: Extra Model / Provider Support

## Goal

Let users chat with models from providers we don't natively curate — hosted OpenAI-compatible APIs (Groq, Mistral, Cerebras, DeepInfra, TogetherAI, xAI, Perplexity, etc.) and self-hosted OpenAI-compatible servers (LM Studio, vLLM, llama.cpp server) — by supplying a base URL, a model id, and (optionally) an API key. No per-vendor SDK integration required.

## Architecture Decision

Most of the providers in the opencode `package.json` list speak the OpenAI chat-completions wire format. Rather than vendoring a dedicated `@ai-sdk/*` package per provider (12+ new dependencies, 12+ bespoke `resolve*` functions), we generalize the **existing** local-model config path — today it's artificially restricted to unauthenticated local servers — into one config-driven mechanism that covers both self-hosted and hosted third-party endpoints:

- **Anthropic / OpenAI / Google** keep their native `@ai-sdk/*` packages unchanged — they need typed `providerOptions` (thinking config, etc.) that a generic client can't express.
- **Ollama** stays a fully separate, live-discovered path — `GET /local-models` queries `{ollamaBaseURL}/api/tags` and synthesizes `ollama/<name>` ids on the fly. Nothing about it is persisted to config, so it needs no schema changes.
- **Everything else** (the new "custom" category) resolves through `@ai-sdk/openai-compatible`'s `createOpenAICompatible({ name, baseURL, apiKey })` instead of `@ai-sdk/openai`'s `createOpenAI` — it's the actual base package vendor SDKs like `@ai-sdk/groq` are built on, and doesn't misrepresent the endpoint as literally being OpenAI.

**Known limitation, accepted as a tradeoff:** structured `providerOptions` (Groq's `reasoningFormat`/`serviceTier`, xAI's `search_parameters`, Mistral's `safePrompt`, etc.) won't be available through the generic path — those are typed schemas baked into each vendor's own package. Reasoning models that emit `<think>...</think>` in plain text can still get their thinking extracted via the AI SDK's provider-agnostic `extractReasoningMiddleware`, which works regardless of provider.

**Out of scope:** Bedrock, Azure, Google Vertex, and Cohere authenticate with cloud credentials or vendor-specific schemes, not a bearer API key + base URL. They don't fit this model at all and are deferred — see "Not in Scope" below.

## Schema Changes

Provider connection (base URL + key) and model (literal model id + capabilities) have different lifetimes — one connection is reused across many models. Baking `baseURL`/`apiKey` into every model entry would mean re-entering the same connection details for every model added under the same account, and rotating a key would mean editing every entry that used it. So this is two config lists, not one, with a one-to-many relationship.

**`packages/shared/src/config.ts`**
- Replace `LocalModelConfig` with two types:
  ```typescript
  export type CustomProviderConfig = {
    id: string;              // opaque, app-generated (e.g. "provider/8f2a1c") — never typed by the user
    name: string;              // the provider's name, e.g. "OpenRouter", "Groq", "LM Studio" — not a personal nickname
    baseURL: string;
    apiKey?: string;             // omitted for unauthenticated local servers
  };

  export type CustomModelConfig = {
    id: string;              // opaque, app-generated (e.g. "custom/1a2b3c")
    providerId: string;        // references CustomProviderConfig.id
    modelId: string;             // literal model string sent to the provider's API; also what the UI displays
    contextWindow?: number;
    vision?: boolean;
    pricing?: ModelPricing;
  };
  ```
- Rename `KoincodeGlobalConfig.localModels` → `customModels: CustomModelConfig[]`, add `customProviders: CustomProviderConfig[]`

**`packages/shared/src/models.ts`**
- `SupportedProvider`: `"local"` → `"custom"`
- `isLocalModelId` → `isCustomOrOllamaModelId`, checks `startsWith("ollama/")` or `startsWith("custom/")` (same call sites as today: `server/lib/models.ts`, `cli/lib/analytics.ts`, `cli/lib/usage.ts`, `cli/providers/prompt-config/index.tsx`)
- `LocalModelsResponse.custom` → `CustomModelConfig[]`

Why the `id` is opaque and app-generated rather than a user-typed `custom/<name>` string (as today's `local/` convention requires): it decouples the internal selector from the literal API model string. Previously `resolveLocalModel` derived the API-facing model name by slicing the `local/` prefix off `id`, which forced the user's internal id and the vendor's real model string to be character-for-character identical after that slice — awkward for verbose real-world model ids like `mistralai/Mistral-7B-Instruct-v0.3`. Splitting `id` (routing key) from `modelId` (literal API string) removes that constraint. Same reasoning applies to `CustomProviderConfig.id` vs `CustomModelConfig.providerId`.

## Form Validation

Without validation, a malformed `baseURL` (missing protocol, typo) or an empty `modelId` typed into the add-provider/add-model forms would write straight into `~/.koincode/config.json` and only surface as a cryptic failure later, deep inside `resolveCustomModel` during a chat request. Validate at the form boundary instead.

**`packages/shared/src/config-schemas.ts`** (new file — kept separate from `config.ts`, which stays pure types, and from `schemas.ts`, which is scoped to tool contracts)
```typescript
import { z } from "zod";

export const customProviderInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  baseURL: z.string().trim().url("Must be a valid URL"),
  apiKey: z.string().trim().optional(),
});

export const customModelInputSchema = z.object({
  modelId: z.string().trim().min(1, "Model id is required"),
  contextWindow: z.coerce.number().int().positive().optional(),
  vision: z.boolean().optional(),
});
```
- `id`/`providerId` are deliberately excluded — they're app-generated, never user input, so there's nothing to validate.
- Both forms (`/setup` add-provider step, `/models` add-model step) call `.safeParse()` on submit and render the first `.error.issues[0].message` inline instead of writing to config on failure.
- Exported from `packages/shared/src/index.ts` alongside the existing schema exports.

## Server Changes

**`packages/server/src/lib/models.ts`**
- `readLocalModels()` → `readCustomModels()` / `readCustomProviders()`, reading `config.customModels` / `config.customProviders`
- Split `resolveLocalModel` into:
  - `resolveOllamaModel(modelId)` — unchanged behavior, strips `ollama/`, `createOpenAI({ baseURL: ollamaBaseURL + "/v1", apiKey: "ollama" })`
  - `resolveCustomModel(modelId)` — looks up the model entry by `id` in `customModels`, then its provider by `providerId` in `customProviders` (throws if either is missing — an orphaned model shouldn't be reachable once cascade delete ships, but this is the defensive fallback), then `createOpenAICompatible({ name: "custom", baseURL: provider.baseURL, apiKey: provider.apiKey ?? "custom" })(model.modelId)`
- `resolveChatModel`: branch on `ollama/` prefix → `resolveOllamaModel`; `custom/` prefix → `resolveCustomModel`; else fall through to `findSupportedChatModel`
- `isSupportedChatModel`: update to use `isCustomOrOllamaModelId`

**`packages/server/package.json`**
- Add `@ai-sdk/openai-compatible` dependency

**`packages/server/src/routes/local-models.ts`**
- No route path/shape change — still returns `{ ollama, custom }`. Internal type updates only (`CustomModelConfig[]` instead of `LocalModelConfig[]`).

## CLI Changes

### Phase 1 — schema consolidation + tab split

**`packages/cli/src/components/dialogs/models-dialog.tsx`**
- Split the single "Local" tab into two: **Custom** and **Ollama** (4 tabs total: Frontier, Free, Custom, Ollama — Tab cycles through all four)
- Ollama tab: unchanged behavior (auto-detect, size hints, empty states)
- Custom tab: lists `customModels` entries, displaying `modelId` directly as the row label (no `displayName` lookup)

**`packages/cli/src/utils/configs/global-config.ts`**
- `updateGlobalConfig`: `updates.localModels` → `updates.customModels`, add `updates.customProviders`

At the end of Phase 1, users can still only add custom models by hand-editing `~/.koincode/config.json` — but the shape is now correct (provider/model split, `id`s still user-supplied at this point) and works for authenticated hosted endpoints, not just unauthenticated local ones.

### Phase 2 — guided add/delete flows

Reuses the two existing dialogs that already own this territory (`/setup` for provider credentials, `/models` for model selection) rather than introducing new top-level commands.

**`/setup` (`packages/cli/src/components/dialogs/setup-dialog.tsx`)**
- The fixed 4-row `PROVIDERS` list (OpenRouter/Anthropic/OpenAI/Gemini) stays as-is — built-ins are edit-only, no add/delete.
- Below it, a dynamic section lists `customProviders` by `name`, each with edit (baseURL/key) and delete actions.
- "+ Add provider" opens a combined two-step form so a provider is never created with zero models attached:
  1. Provider step: name (e.g. "Groq"), base URL, API key (optional) — validated against `customProviderInputSchema` before advancing to step 2
  2. Model step (same form, immediately after): model id, context window (optional), vision (optional toggle) — validated against `customModelInputSchema`
  - On submit, both a `CustomProviderConfig` and its first `CustomModelConfig` are generated (opaque `id`s) and written together via one `updateGlobalConfig({ customProviders: [...], customModels: [...] })` call
- Deleting a custom provider cascades: removes the provider and every `CustomModelConfig` whose `providerId` matches, with a confirmation showing the count (e.g. "Delete Groq and its 3 models?")

**`/models` Custom tab (`packages/cli/src/components/dialogs/models-dialog.tsx`)**
- Lists `customModels`, displaying `modelId` directly as the row label (no `displayName` lookup)
- "+ Add model" — for adding additional models to a provider that already exists: pick a `customProviders` entry (or jump into the `/setup` add-provider flow if none exist yet), then just model id / context window / vision — validated against `customModelInputSchema` before writing
- Per-row delete action removes a single `CustomModelConfig` (no cascade — deleting a model never touches its provider)
- User never types or sees the `custom/`/`provider/` prefixes — both are generated by the app

## Not in Scope

- **Amazon Bedrock, Azure OpenAI, Google Vertex, Cohere** — authenticate via cloud credentials (IAM roles, resource names, service accounts) rather than a single bearer API key, so they don't fit the `baseURL + apiKey` shape at all. Would need dedicated per-provider config sections and their real `@ai-sdk/*` packages. Revisit only if there's concrete user demand.
- **Structured `providerOptions` passthrough for custom models** (reasoning effort, service tier, safety settings, etc.) — would require either vendoring each provider's SDK (defeats the purpose of this feature) or building a generic passthrough schema. Not attempted here.
- **Migrating existing hand-written `local/` config entries** — pre-1.0, no known external users depend on the old shape, so this is a clean rename with no compatibility shim.

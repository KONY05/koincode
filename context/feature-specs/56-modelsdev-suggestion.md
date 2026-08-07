# Dynamic Model Metadata & Pricing Sync via models.dev

Created At: 2026-08-05T19:23:44Z

## Overview
KOINCODE uses a curated list of AI models defined in [models.ts](file:///Users/mac/Documents/Code/KOINCODE/packages/shared/src/models.ts). However, provider pricing (input/output USD per million tokens), context window ceilings, vision capabilities, and accepted reasoning effort levels shift frequently over time.

This feature spec defines a hybrid model registry that retains KOINCODE's custom model definitions (IDs, provider assignments, and human-readable UI labels) while dynamically fetching and enriching pricing, context windows, vision support, and reasoning effort levels from `models.dev` (`https://models.dev/api.json`).

---

## Architectural Goals & Design Decisions

1. **Curated Model Registry with Dynamic Enrichment**:
   - KOINCODE defines the list of supported model IDs, providers, and custom labels in [models.ts](file:///Users/mac/Documents/Code/KOINCODE/packages/shared/src/models.ts).
   - Static fallback values are retained for offline / air-gapped support or when `models.dev` is unreachable.
   - At server initialization (and refreshed periodically, e.g. every 24 hours), the server fetches `https://models.dev/api.json` and updates the active runtime metadata.

2. **Custom Labels & Provider Groupings Preserved**:
   - Provider names (`anthropic`, `openai`, `google`, `xai`, `openrouter`) and UI display labels (`Claude Sonnet 5`, `GPT-5.6 Sol`, `Gemini 3.5 Flash`) remain under KOINCODE's control.

3. **Dynamic Capabilities & Reasoning Effort**:
   - **Pricing**: `cost.input` -> `pricing.inputUsdPerMillionTokens`, `cost.output` -> `pricing.outputUsdPerMillionTokens`.
   - **Context Window**: `limit.context` -> `contextWindow`.
   - **Vision**: `modalities.input.includes("image")` -> `vision`. Image inputs are the *only* thing that makes a model vision-capable — models.dev's `attachment` flag (file uploads incl. PDFs) does not count, since PDFs and other files are read and transcoded locally in the CLI's `read-file` tool.
   - **Reasoning Effort Levels**: Parsed dynamically from `models.dev` `reasoning_options` (`type: "effort"` `values`), matched against KOINCODE's allowed `ReasoningEffortLevel` set (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`).

---

## Mapping Specification (`models.dev/api.json`)

### Lookup Strategy
For a model with `id` and `provider` in KOINCODE:
1. Lookup `apiData[provider]?.models[id]`.
2. If not found under `apiData[provider]`, search across all providers in `apiData` for any model entry matching `id` (crucial for OpenRouter models or cross-registered providers).

### Field Extraction & Fallbacks

| KOINCODE Field | `models.dev` Source Path | Fallback |
| :--- | :--- | :--- |
| `pricing.inputUsdPerMillionTokens` | `cost.input` | Static value from KOINCODE model definition |
| `pricing.outputUsdPerMillionTokens` | `cost.output` | Static value from KOINCODE model definition |
| `contextWindow` | `limit.context` | Static value from KOINCODE model definition |
| `vision` | `modalities.input.includes("image") \|\| attachment === true` | Static value from KOINCODE model definition |
| `reasoningEffort` | `reasoning_options` array element with `type: "effort"` -> `values` | Static array or `undefined` if model has no reasoning options |

---

## Implementation Outline

1. **`packages/shared/src/models.ts`**:
   - Export helper types and utility functions for merging model definitions.

2. **`packages/server/src/lib/models-registry.ts` (New Module)**:
   - `fetchModelsDevRegistry()`: Fetches `https://models.dev/api.json` with a configurable URL (`MODELS_DEV_API_URL` env variable fallback).
   - In-memory caching with TTL (24 hours) and background revalidation.
   - `getEnrichedChatModels()`: Returns the merged catalog of `SupportedChatModelDefinition[]`.

3. **Server Initialization & Routes**:
   - Trigger `models-registry` pre-fetch on server boot.
   - Use `getEnrichedChatModels()` in model listing endpoints and token cost calculations.

4. **Testing**:
   - Add unit tests verifying `models.dev` JSON parsing, capability extraction, reasoning effort filtering, and fallback behavior when network requests fail.

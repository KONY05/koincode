# Feature 36: External Provider Support (Sign in with Subscription)

## Origin

> i was looking at opencode and i was seeing a lot of cool things there i saw they could connect an external provider like your chatgpt subscription pro/plus to the app and use it same for multiple other providers and i was wondering if we could do something like that as well and how it would work, images are attached to give you more context

Reference: opencode's "Connect a provider" screen (Popular list: OpenCode Zen, OpenCode Go, OpenAI, GitHub Copilot, Anthropic, Google) followed by a per-provider "Select auth method" screen (ChatGPT Pro/Plus via browser, ChatGPT Pro/Plus headless, or manually enter API key).

## Goal

Let a user authenticate a provider using their existing consumer subscription (ChatGPT Plus/Pro, Claude Pro/Max) instead of pasting a pay-per-token API key, so KOINCODE requests draw against the subscription's included usage. This is the same mechanism OpenAI's Codex CLI and Anthropic's own Claude Code use internally — a browser-based OAuth login against the provider's consumer auth surface, not their developer API key system.

## Scope (v1)

- **Providers:** Anthropic and OpenAI only — the two built-in providers that already have a direct-key path (`packages/server/src/lib/models.ts`) and a first-party "sign in with subscription" precedent to mirror. Gemini has no equivalent consumer-OAuth flow to target; GitHub Copilot and OpenCode Zen/Go have no existing KOINCODE analog (no hosted gateway of our own) — out of scope.
- **Auth methods per provider:** existing "paste API key" (unchanged) plus new "Sign in with subscription," offered as a choice — mirrors opencode's two-screen picker, not a replacement.
- **Both interactive variants:** browser flow (local callback listener + system browser launch) and a headless/device-code-style flow (print URL + code, user completes on another device). Headless is not secondary here — KOINCODE is regularly run over SSH, so a browser-only flow would lock out a real chunk of usage.

## Why this doesn't slot into the existing key-entry mechanism

Checked against the current implementation before scoping this:

- `ApiKeys` (`packages/shared/src/config.ts`) is `{ openrouter?, anthropic?, openai?, gemini?: string }` — flat strings. There is no token/expiry/refresh shape anywhere in the config types.
- `resolveAnthropicModel` / `resolveOpenAIModel` (`packages/server/src/lib/models.ts`) call the AI SDK's `anthropic()` / `openai()` factories with no `baseURL` override, so they hit the standard `api.anthropic.com` / `api.openai.com` endpoints. Only the custom-provider path (`resolveCustomModel`) currently supports a configurable `baseURL`. The subscription-backed path needs a *different* base URL and headers per provider (e.g. OpenAI's Codex flow talks to `chatgpt.com/backend-api/codex`, not `api.openai.com`) — this is a distinct request path, not a swapped-in key.
- No token-refresh logic exists anywhere in the repo. OAuth access tokens from this kind of flow are short-lived and need silent refresh before each request.
- No local HTTP callback listener or system-browser-launch code exists (checked — the only `createServer`/browser-launch hits in the repo are the Playwright browser-tool infra, unrelated to auth).
- `/setup`'s built-in provider rows are single-field (`EditKeyView`, one textarea, Enter to save). There's no auth-method sub-picker today.

## Design

### 1. Shared: credential shape (`packages/shared/src/config.ts`)

Extend the per-provider value in `ApiKeys` to accept either the existing plain string or an OAuth credential object, tagged so the server knows which resolution path to use:

```ts
type OAuthCredential = {
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  accountId?: string; // some flows scope requests to a specific workspace/account id
};

type ApiKeyValue = string | OAuthCredential;
```

Storage location is unchanged — still `~/.koincode/config.json`, same as plain keys today. No new storage mechanism; consistent with how direct provider keys are already handled (plaintext in the global config file). Refresh tokens are longer-lived and broader-scoped than a scoped API key, which is worth flagging to the user as a caveat in the `/setup` UI copy, but not a reason to invent a new storage mechanism inconsistent with the rest of the config file.

### 2. Server: resolution + refresh (`packages/server/src/lib/models.ts`)

`resolveAnthropicModel` / `resolveOpenAIModel` branch on the stored credential's shape:

- Plain string → existing behavior, unchanged.
- `OAuthCredential` → check `expiresAt`, refresh first if needed (persist the new token pair back to config), then construct the provider client against the subscription-backed base URL with the bearer token and any provider-required headers, instead of the standard developer-API path.

### 3. CLI: interactive login (new)

- **Browser variant:** open the system browser to the provider's authorization URL (PKCE, no client secret — these are public installed-app clients), start a short-lived local HTTP listener to catch the redirect, exchange the code for tokens, write the `OAuthCredential` to config.
- **Headless variant:** print the authorization URL (and, where the provider supports it, a short device code) for the user to complete on another machine/browser, then poll or prompt for the resulting code to exchange.

### 4. CLI: `/setup` UI

Selecting Anthropic or OpenAI in `/setup` shows a small auth-method picker (mirrors opencode's second screen) before falling into the existing `EditKeyView`:

- "Enter API key" → existing flow, unchanged.
- "Sign in with subscription" → new flow from #3.

## Net-new work, in dependency order

1. **Shared credential type + config schema** — mechanical, unlocks everything else, no external dependency.
2. **Server-side refresh + subscription-backed request path** — can be built and tested against a manually-obtained token pair before the CLI login UI exists.
3. **CLI browser login flow** (callback listener + browser launch + token exchange).
4. **CLI headless login flow** (reuses the token-exchange logic from #3, different code-acquisition step).
5. **`/setup` auth-method picker wiring** — thin UI layer over #3/#4, done last.

## Package boundaries

Touches all three of shared, server, and CLI — unavoidable for an OAuth credential (shared type, server-side resolution, CLI-side interactive login), but each numbered step above is independently implementable and verifiable, satisfying the "one feature unit at a time" rule even though the feature as a whole crosses package lines.

## Open questions (blocking implementation — not to be guessed at)

- **Exact OAuth endpoints, client IDs, and required headers** for OpenAI's ChatGPT-subscription flow and Anthropic's Claude Pro/Max flow. These must be sourced from the actual public implementations (OpenAI's open-source Codex CLI, Anthropic's Claude Code) rather than invented or reverse-engineered speculatively — get the real values before writing #2/#3 above.
- **ToS framing** — OpenAI/Anthropic sanction this flow for their own first-party CLIs; a third-party tool replicating it to draw down subscription quota is closer to gray-area territory (though prior art like opencode ships it publicly). Decide whether `/setup` should carry an explicit disclaimer before a user opts into this, and whether it ships as a clearly-labeled opt-in vs. a first-class equal option next to "API key."
- **Provider priority** — build OpenAI first (matches the screenshots that prompted this) then Anthropic, or both together? Recommend OpenAI first as a single verifiable slice per the incremental-work rule, then port the same shape to Anthropic once the pattern is proven.

## Status

Spec drafted, not yet implemented. Next step: resolve the OAuth-endpoint open question, then start at step 1 (shared credential type).

## Decision

`/review-connect`, `/review-disconnect`, and `/review-status` are hardcoded to GitHub today — `resolveCurrentRepo()` (`lib/review/review-repo.ts`) only recognizes `github.com` remotes and explicitly rejects everything else (`reason: "not-github"`). KOINCODE-Review now supports GitLab and Azure DevOps as git hosts (its own Features 17–20), so this needs to become provider-aware to match. This is the CLI-side half of that work — the server-side half (wire contract, backward-compat default, a real lookup bug it also surfaces) is spec'd separately in the KOINCODE-Review repo at `context/feature-spec/21-cli-multi-provider-repo-support.md`. **That document is the source of truth for the wire contract** (request/response shapes) — this spec must match it exactly, not diverge on its own judgment.

## Design

### Provider detection (`lib/review/review-repo.ts`)

Replace the single `GITHUB_REMOTE_RE` with one matcher per provider, tried in sequence. GitLab and Azure DevOps each need their own pattern — Azure DevOps in particular has three distinct URL shapes in real use:

```ts
export type GitProviderId = "github" | "gitlab" | "azure_devops";

export type ResolvedRepo = {
  provider: GitProviderId;
  owner: string; // "organization/project" for azure_devops, plain owner otherwise
  repo: string;
};

export type ResolveRepoResult =
  | { ok: true; repo: ResolvedRepo }
  | { ok: false; reason: "no-remote" | "unsupported-host" };

// gitlab.com only — no self-hosted GitLab support, matching
// KOINCODE-Review's own gitlab.com-only scope (its lib/providers/gitlab/client.ts).
const GITLAB_REMOTE_RE = /gitlab\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/;

// Azure DevOps has three URL shapes in real use:
//   https://dev.azure.com/{org}/{project}/_git/{repo}
//   https://{org}.visualstudio.com/{project}/_git/{repo}  (legacy domain, still common)
//   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}        (SSH)
const AZURE_DEVOPS_HTTPS_RE = /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/;
const AZURE_DEVOPS_VISUALSTUDIO_RE = /([^./]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/;
const AZURE_DEVOPS_SSH_RE = /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/;
```

`resolveCurrentRepo()` tries GitHub's existing regex first (unchanged, cheapest/most common case), then GitLab's, then all three Azure DevOps patterns — for the two Azure DevOps matches, combine `{org}/{project}` into a single `owner` string before returning, since that's the shape KOINCODE-Review's API expects (confirmed against its spec — its `RemoteRepo.owner` convention for Azure DevOps is already `"organization/project"` everywhere in that app). No remote matching any pattern → `{ok: false, reason: "unsupported-host"}` (renamed from `"not-github"`, an internal reason code with no external consumers to break).

### API client (`lib/review/review-api.ts`)

`connectRepo`, `disconnectRepo`, `getRepoStatus` each gain a `provider: GitProviderId` parameter, included in the request body (connect/disconnect) or query string (status) alongside the existing `owner`/`repo`. Matches the KOINCODE-Review spec's wire contract exactly — `provider` is a real field there now, not optional on this side since we always know it once `resolveCurrentRepo()` succeeds (the *server's* default-to-github is purely for already-installed older CLI versions, not something this updated client should ever rely on).

```ts
export async function connectRepo(
  provider: GitProviderId,
  owner: string,
  repo: string,
): Promise<ConnectRepoResult> {
  const res = await authedFetch("/api/cli/repos/connect", {
    method: "POST",
    body: JSON.stringify({ provider, owner, repo }),
  });
  ...
}
```

Same shape change for `disconnectRepo` and `getRepoStatus` (the latter adds `&provider=${provider}` to its query string).

### Commands (`commands.tsx`) and status dialog (`review-status-dialog.tsx`)

Both call sites (`/review-connect`, `/review-disconnect`) and the status dialog's `resolvePreCheck()` currently branch on `resolved.reason === "no-remote"` vs. a hardcoded "Only GitHub repositories are supported" message. Update:

- Error copy: `"Only GitHub repositories are supported"` → something like `"Unsupported git host — GitHub, GitLab, and Azure DevOps are supported"` (3 call sites: `/review-connect`, `/review-disconnect`, `review-status-dialog.tsx`).
- Pass `resolved.repo.provider` through to `connectReviewRepo(provider, owner, repo)` / `disconnectReviewRepo(provider, owner, repo)` / `getRepoStatus(provider, owner, repo)`.
- **Display strings need no change.** `${owner}/${repo}` template literals (used in toasts and the status dialog) already render correctly for Azure DevOps without any special-casing — since `owner` is `"organization/project"`, the existing interpolation naturally produces `organization/project/repo`, the correct 3-segment display. Confirmed this works out before writing any conditional-rendering logic for it; don't add one.

## Package Boundaries

Entirely within `packages/cli` — `lib/review/review-repo.ts`, `lib/review/review-api.ts`, `components/command-menu/commands.tsx`, `components/dialogs/review-status-dialog.tsx`. No `packages/shared` or `packages/server` changes; this doesn't touch model resolution, config storage, or anything cross-package.

## Suggested Implementation Order

1. `review-repo.ts` — new types, GitLab/Azure DevOps regexes, updated `resolveCurrentRepo()`. Verify against real remotes of each shape before moving on (a plain unit test per regex is cheap insurance here, given three Azure DevOps URL variants to get right).
2. `review-api.ts` — add `provider` param to the three repo functions. This is where the wire contract actually has to match the KOINCODE-Review spec exactly — cross-check field names/placement against that repo's `context/feature-spec/21-cli-multi-provider-repo-support.md` before considering this step done.
3. `commands.tsx` + `review-status-dialog.tsx` — thread `provider` through, update error copy.
4. Manual end-to-end check against a real GitLab and a real Azure DevOps repo (not just GitHub) — the three-way regex branching in step 1 is exactly the kind of thing that looks right on inspection but silently mis-parses one shape.

## Open Questions / Deferred

- Whether `/review-status`'s three-call-site error copy should live in one shared constant instead of being repeated — small enough that it wasn't worth a shared-constants module before, but worth reconsidering now that it's tripling in the number of places it needs to change together.
- KOINCODE-Review's own server-side change (spec 21 in that repo) needs to ship before this client update actually works end-to-end for GitLab/Azure DevOps — the server's backward-compat default only protects *already-installed* CLI versions, not this updated one, which sends `provider` unconditionally. Coordinate deploy order, or confirm the server-side change is already live before shipping this.

## Status

Implemented on branch `feature/multi-provider-support`: `review-repo.ts` (provider detection), `review-api.ts` (wire contract), `commands.tsx` + `review-status-dialog.tsx` (call sites + error copy). Verified via `tsc --noEmit` only — not yet manually tested against real GitLab/Azure DevOps remotes, and not yet verified end-to-end since it depends on KOINCODE-Review's server-side half (spec 21) being deployed.

import { execSync } from "node:child_process";

export type GitProviderId = "github" | "gitlab" | "azure_devops";

export type ResolvedRepo = {
  provider: GitProviderId;
  owner: string; // "organization/project" for azure_devops, plain owner otherwise
  repo: string;
};

// Matches both SSH (git@github.com:owner/repo.git) and HTTPS
// (https://github.com/owner/repo.git) remotes, with or without a trailing ".git".
const GITHUB_REMOTE_RE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/;

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

export type ResolveRepoResult =
  | { ok: true; repo: ResolvedRepo }
  | { ok: false; reason: "no-remote" | "unsupported-host" };

/** Resolves the current directory's git remote into a provider-qualified owner/repo
 * pair — same `git remote get-url origin` this codebase already shells out to
 * elsewhere (see lib/git-status.ts) for other repo-state reads. */
export function resolveCurrentRepo(): ResolveRepoResult {
  let remoteUrl: string;
  try {
    remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { ok: false, reason: "no-remote" };
  }

  const githubMatch = remoteUrl.match(GITHUB_REMOTE_RE);
  if (githubMatch?.[1] && githubMatch[2]) {
    return {
      ok: true,
      repo: { provider: "github", owner: githubMatch[1], repo: githubMatch[2] },
    };
  }

  const gitlabMatch = remoteUrl.match(GITLAB_REMOTE_RE);
  if (gitlabMatch?.[1] && gitlabMatch[2]) {
    return {
      ok: true,
      repo: { provider: "gitlab", owner: gitlabMatch[1], repo: gitlabMatch[2] },
    };
  }

  for (const re of [
    AZURE_DEVOPS_HTTPS_RE,
    AZURE_DEVOPS_VISUALSTUDIO_RE,
    AZURE_DEVOPS_SSH_RE,
  ]) {
    const match = remoteUrl.match(re);
    if (match?.[1] && match[2] && match[3]) {
      return {
        ok: true,
        repo: {
          provider: "azure_devops",
          owner: `${match[1]}/${match[2]}`,
          repo: match[3],
        },
      };
    }
  }

  return { ok: false, reason: "unsupported-host" };
}

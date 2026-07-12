import { execSync } from "node:child_process";

export type ResolvedRepo = {
  owner: string;
  repo: string;
};

// Matches both SSH (git@github.com:owner/repo.git) and HTTPS
// (https://github.com/owner/repo.git) remotes, with or without a trailing ".git".
const GITHUB_REMOTE_RE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/;

export type ResolveRepoResult =
  | { ok: true; repo: ResolvedRepo }
  | { ok: false; reason: "no-remote" | "not-github" };

/** Resolves the current directory's git remote into a GitHub owner/repo pair —
 * same `git remote get-url origin` this codebase already shells out to elsewhere
 * (see lib/git-status.ts) for other repo-state reads. */
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

  const match = remoteUrl.match(GITHUB_REMOTE_RE);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!owner || !repo) return { ok: false, reason: "not-github" };

  return { ok: true, repo: { owner, repo } };
}

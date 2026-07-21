import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../../providers/theme";
import { resolveCurrentRepo, type GitProviderId } from "../../lib/review/review-repo";
import { readReviewAuth } from "../../lib/review/review-auth";
import {
  getRepoStatus,
  ReviewAuthRequiredError,
  type RepoStatus,
} from "../../lib/review/review-api";

// Resolved synchronously once at mount via useState's lazy initializer below
// (not in an effect) — a plain fs read + execSync, not something to
// re-derive on every render, but also not an external subscription that
// belongs in an effect body.
type PreCheck =
  | { kind: "not-logged-in" }
  | { kind: "no-remote" }
  | { kind: "unsupported-host" }
  | { kind: "ready"; provider: GitProviderId; owner: string; repo: string };

function resolvePreCheck(): PreCheck {
  if (!readReviewAuth()) return { kind: "not-logged-in" };

  const resolved = resolveCurrentRepo();
  if (!resolved.ok) {
    return { kind: resolved.reason === "no-remote" ? "no-remote" : "unsupported-host" };
  }

  return {
    kind: "ready",
    provider: resolved.repo.provider,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
  };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "no-remote" }
  | { kind: "unsupported-host" }
  | { kind: "not-logged-in" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; owner: string; repo: string; status: RepoStatus };

export function ReviewStatusDialogContent() {
  const { colors } = useTheme();
  const [preCheck] = useState<PreCheck>(resolvePreCheck);
  const [state, setState] = useState<LoadState>(
    preCheck.kind === "ready" ? { kind: "loading" } : preCheck,
  );

  useEffect(() => {
    // Nothing to fetch — `state` already reflects this from the lazy
    // initializer above, so there's no setState to make here at all.
    if (preCheck.kind !== "ready") return;

    let cancelled = false;

    const { provider, owner, repo } = preCheck;

    async function loadStatus() {
      try {
        const status = await getRepoStatus(provider, owner, repo);
        if (cancelled) return;
        setState({ kind: "loaded", owner, repo, status });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ReviewAuthRequiredError) {
          setState({ kind: "not-logged-in" });
          return;
        }
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load status",
        });
      }
    }

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [preCheck]);

  if (state.kind === "loading") {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Checking status…</text>
      </box>
    );
  }

  if (state.kind === "not-logged-in") {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text fg={colors.error}>Not logged in.</text>
        <text attributes={TextAttributes.DIM}>
          Run /review-login to connect your KOINCODE-Review account.
        </text>
      </box>
    );
  }

  if (state.kind === "no-remote" || state.kind === "unsupported-host") {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text fg={colors.error}>
          {state.kind === "no-remote"
            ? "No git remote found in this directory."
            : "Unsupported git host — GitHub, GitLab, and Azure DevOps are supported."}
        </text>
      </box>
    );
  }

  if (state.kind === "error") {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text fg={colors.error}>{state.message}</text>
      </box>
    );
  }

  const { owner, repo, status } = state;

  if (!status.connected) {
    return (
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <text fg={colors.primary}>
          {owner}/{repo}
        </text>
        <text attributes={TextAttributes.DIM}>
          Not connected. Run /review-connect to enable automatic PR reviews.
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      <box flexDirection="row" gap={2}>
        <text fg={colors.primary}>
          {owner}/{repo}
        </text>
        <text attributes={TextAttributes.DIM}>
          Connected · indexing {status.indexingStatus}
        </text>
      </box>
      {status.lastReview ? (
        <box flexDirection="column" gap={0}>
          <text>
            Last review: PR #{status.lastReview.prNumber} —{" "}
            {status.lastReview.prTitle}
          </text>
          <text attributes={TextAttributes.DIM}>
            {status.lastReview.status} · {status.lastReview.createdAt}
          </text>
        </box>
      ) : (
        <text attributes={TextAttributes.DIM}>No reviews yet.</text>
      )}
    </box>
  );
}

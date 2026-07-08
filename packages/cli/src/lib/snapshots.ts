import { createHash } from "crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";

import { SNAPSHOTS_DIR } from "@koincode/shared";
import { apiClient } from "./api-client";

// Above this, the file is still written/edited normally but no snapshot blob
// is stored — reverting a giant generated file isn't worth the disk cost.
// The hash is still returned so the revert chain can detect this as a
// missing-blob conflict rather than silently reverting nothing.
export const MAX_SNAPSHOT_BYTES = 2_000_000;

export function hashContent(content: string) {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// Snapshots are namespaced per project (keyed by a hash of cwd, not the raw
// path, since paths can contain characters that aren't safe as directory
// names) so `~/.koincode/snapshots/` doesn't become one giant flat pool
// shared across every project ever opened, and so the orphan sweep only
// ever has to reason about the current project's blobs.
function projectSnapshotsDir(cwd = process.cwd()) {
  return join(SNAPSHOTS_DIR, hashContent(cwd));
}

const SWEEP_STATE_FILENAME = ".sweep-state.json";

/**
 * Hashes `content` and, if under the size cap, persists it as a
 * content-addressed blob under the current project's snapshot directory.
 * `null` in, `null` out — used for the "before" state of a `writeFile` call
 * on a path that didn't exist yet.
 */
export async function captureSnapshot(
  content: string | null,
): Promise<string | null> {
  if (content === null) return null;
  const hash = hashContent(content);
  if (Buffer.byteLength(content, "utf-8") <= MAX_SNAPSHOT_BYTES) {
    const dir = projectSnapshotsDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, hash), content, "utf-8");
  }
  return hash;
}

/** Throws if the blob doesn't exist (never captured, or already swept). */
export async function readSnapshot(hash: string): Promise<string> {
  return readFile(join(projectSnapshotsDir(), hash), "utf-8");
}

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes snapshot blobs nothing references anymore, scoped to the current
 * project's snapshot directory. Throttled to at most once a day per project
 * (state file lives alongside the blobs it tracks), and entirely
 * opportunistic — it never starts the server itself (that would add startup
 * latency for a background cleanup task); it just skips silently if the
 * server isn't already up and retries next time this is called.
 */
export async function sweepOrphanSnapshots(): Promise<void> {
  try {
    const dir = projectSnapshotsDir();
    const stateFile = join(dir, SWEEP_STATE_FILENAME);

    let lastSweptAt = 0;
    try {
      const state = JSON.parse(await readFile(stateFile, "utf-8")) as {
        lastSweptAt?: number;
      };
      lastSweptAt = state.lastSweptAt ?? 0;
    } catch {
      // No state file yet — first run for this project.
    }
    if (Date.now() - lastSweptAt < SWEEP_INTERVAL_MS) return;

    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f !== SWEEP_STATE_FILENAME);
    } catch {
      // Nothing captured yet for this project.
    }

    if (files.length > 0) {
      const res = await apiClient.snapshots["referenced-hashes"].$get({
        query: { cwd: process.cwd() },
      });
      if (!res.ok) return; // server not reachable — try again next time, don't record a sweep
      const { hashes } = await res.json();
      const referenced = new Set(hashes);
      await Promise.all(
        files
          .filter((file) => !referenced.has(file))
          .map((file) => unlink(join(dir, file)).catch(() => {})),
      );
    }

    await mkdir(dir, { recursive: true });
    await writeFile(stateFile, JSON.stringify({ lastSweptAt: Date.now() }));
  } catch {
    // Best-effort background cleanup — never let this affect the app.
  }
}

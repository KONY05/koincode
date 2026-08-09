/**
 * Update logic for koincode — handles two install methods:
 *
 * 1. npm-managed installs (npm/bun/yarn/pnpm):
 *    Detects which package manager was used and runs `<mgr> install -g koincode`.
 *    The package manager handles downloading the new platform binary via optionalDependencies.
 *
 * 2. curl/iex installs (direct binary download):
 *    Downloads the new binary from GitHub Releases and atomically replaces the
 *    current binary on disk. Handles permission errors (root-owned directories)
 *    and macOS quarantine flags.
 *
 * Three entry points:
 *   - checkForUpdate()  — returns new version string or null (used by the update check hook)
 *   - runUpdate()       — called from the /update command menu (tears down TUI first)
 *   - runCliUpdate()    — called from `koincode --update` flag (no TUI involved)
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";

import { PID_FILE } from "@koincode/shared";
import { version as currentVersion } from "../../package.json";
import { Sentry } from "./sentry";

export { currentVersion };

const isWindows = process.platform === "win32";

export type InstallMethod = "npm" | "curl";

/**
 * Determines how koincode was installed by examining the binary's own path.
 * npm/bun installs live inside node_modules; curl/iex installs land in
 * standalone directories like /usr/local/bin or ~/.local/bin.
 */
export function detectInstallMethod(): InstallMethod {
  const binPath = process.execPath;
  if (binPath.includes("node_modules") || binPath.includes(".bun")) {
    return "npm";
  }
  return "curl";
}

export async function checkForUpdate(): Promise<string | null> {
  const res = await fetch("https://registry.npmjs.org/koincode/latest", {
    // Generous for slow networks — this only gates the version check. (15s)
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);
  const data = await res.json();
  if (
    data != null &&
    typeof data === "object" &&
    "version" in data &&
    typeof data.version === "string"
  ) {
    return data.version !== currentVersion ? data.version : null;
  }
  throw new Error("Unexpected registry response");
}

function getBinaryAssetName(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch;
  const suffix = isWindows ? ".exe" : "";
  return `koincode-${platform}-${arch}${suffix}`;
}

/* -------- Download progress rendering -------- */

const ANSI_WHITE = "\u001b[37m";
// ANSI-256 "gold" (bright yellow) — mirrors the header's Koin(white)/Code(gold) split.
const ANSI_GOLD = "\u001b[38;5;220m";
const ANSI_DIM = "\u001b[90m";
const ANSI_RESET = "\u001b[0m";
const CLEAR_LINE = "\u001b[2K\r";

const KOINCODE_LETTERS = "KOINCODE";

export interface UpdateProgress {
  downloaded: number;
  total: number | null; // null when the server didn't send Content-Length
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * Renders a single-line download readout. Instead of a block bar, the
 * "koincode" wordmark is revealed letter by letter (~12.5% per letter) as
 * bytes arrive, keeping the header's brand treatment: the first half is
 * white, the second half is gold. The line itself only shows the percentage
 * (bytes as a fallback when the server didn't send Content-Length — GitHub
 * releases always do).
 */
function renderProgressLine(downloaded: number, total: number | null): string {
  const pct =
    total !== null && total > 0
      ? Math.min(100, Math.round((downloaded / total) * 100))
      : null;
  const revealed = pct !== null
    ? Math.floor((pct / 100) * KOINCODE_LETTERS.length)
    : 0;
  const half = Math.ceil(KOINCODE_LETTERS.length / 2);

  let word = "";
  for (let i = 0; i < KOINCODE_LETTERS.length; i++) {
    if (i > 0) word += " ";
    const letter = KOINCODE_LETTERS[i];
    const color = i < revealed ? (i < half ? ANSI_WHITE : ANSI_GOLD) : ANSI_DIM;
    word += color + letter + ANSI_RESET;
  }

  const readout = pct !== null ? `${pct}%` : formatBytes(downloaded);
  return `  ${word}  ${readout}`;
}

/**
 * Progress renderer for the curl download path. Uses raw terminal escapes
 * (a single \r-redrawn line), so it works both after the TUI has torn down
 * (/update) and in the headless --update path. No-ops when stdout is not a TTY.
 */
function createDownloadProgress(): {
  onProgress: (p: UpdateProgress) => void;
  finish: () => void;
} {
  let rendered = false;
  return {
    onProgress(p) {
      if (!process.stdout.isTTY) return;
      process.stdout.write(CLEAR_LINE + renderProgressLine(p.downloaded, p.total));
      rendered = true;
    },
    finish() {
      if (rendered) process.stdout.write(CLEAR_LINE + "\n");
    },
  };
}

/* -------- Self update (curl/iex installs) -------- */

/**
 * A stalled connection (not a slow one) can otherwise hang forever, so we keep
 * timeouts — but they no longer penalize slow-but-alive networks:
 *
 * - STALLED_TIMEOUT_MS aborts only when no data arrives for a full 2 minutes.
 *   Every received chunk resets the clock, so a slow download can take as long
 *   as it needs as long as it keeps making progress.
 * - MAX_TOTAL_MS is a hard backstop against a connection that trickles bytes
 *   forever without ever completing.
 *
 * The rendered progress bar is what tells the user "still working" during the
 * wait — previously this stage was a silent 5-minute total timeout with zero
 * feedback, which made slow updates look hung and fail.
 */
const STALLED_TIMEOUT_MS = 120_000; // abort if no data for 2 minutes
const MAX_TOTAL_MS = 30 * 60_000; // hard cap: 30 minutes

/**
 * Self-update for curl/iex installs. Downloads the new binary from GitHub
 * Releases and atomically replaces the current binary on disk.
 *
 * Reports download progress via options.onProgress (used to render the branded
 * progress bar); the background auto-download path omits it and stays silent.
 *
 * On Unix: writes to a temp file in the same directory, then renames over the
 * current binary (atomic on same filesystem).
 * On Windows: renames current to .old, moves new into place, deletes .old
 * (can't overwrite a running executable on Windows).
 */
export async function downloadSelfUpdate(
  newVersion: string,
  options: { onProgress?: (p: UpdateProgress) => void } = {},
): Promise<"downloaded" | "permission-denied" | "error"> {
  const binPath = process.execPath;
  const assetName = getBinaryAssetName();
  const url = `https://github.com/KONY05/koincode/releases/download/v${newVersion}/${assetName}`;

  const controller = new AbortController();
  const startedAt = Date.now();
  let lastActivityAt = Date.now();
  const stallTimer = setInterval(() => {
    const now = Date.now();
    if (now - lastActivityAt > STALLED_TIMEOUT_MS) {
      controller.abort(new Error("Download stalled — no data received for 2 minutes"));
    } else if (now - startedAt > MAX_TOTAL_MS) {
      controller.abort(new Error("Download exceeded 30 minutes"));
    }
  }, 15_000);
  const stopStallTimer = () => clearInterval(stallTimer);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    if (!res.body) throw new Error("Download failed: no response body");

    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : null;

    // Stream the body so the user sees progress instead of a frozen line.
    const body = Readable.fromWeb(
      res.body as unknown as import("node:stream/web").ReadableStream,
    );
    const chunks: Buffer[] = [];
    let downloaded = 0;
    for await (const chunk of body) {
      lastActivityAt = Date.now();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      downloaded += buf.length;
      options.onProgress?.({ downloaded, total });
    }
    const buffer = Buffer.concat(chunks);

    const suffix = isWindows ? ".exe" : "";
    const tmpPath = path.join(
      path.dirname(binPath),
      `.koincode-update-${newVersion}${suffix}`,
    );

    try {
      fs.writeFileSync(tmpPath, buffer);
      fs.chmodSync(tmpPath, 0o755);

      if (isWindows) {
        const oldPath = `${binPath}.old`;
        try { fs.unlinkSync(oldPath); } catch {}
        fs.renameSync(binPath, oldPath);
        fs.renameSync(tmpPath, binPath);
        try { fs.unlinkSync(oldPath); } catch {}
      } else {
        fs.renameSync(tmpPath, binPath);
      }

      if (process.platform === "darwin") {
        try {
          execSync(`xattr -d com.apple.quarantine "${binPath}"`, {
            stdio: "ignore",
          });
        } catch {}
      }

      return "downloaded";
    } catch (err: unknown) {
      try { fs.unlinkSync(tmpPath); } catch {}
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === "EACCES" || code === "EPERM") {
        return "permission-denied";
      }
      Sentry.captureException(err, { extra: { stage: "install", url, binPath } });
      return "error";
    }
  } catch (err: unknown) {
    Sentry.captureException(err, { extra: { stage: "download", url } });
    return "error";
  } finally {
    stopStallTimer();
  }
}

function detectPackageManager(): { cmd: string; args: string[] } {
  // Check how koincode was installed by looking at the executable path
  const execPath = process.argv[1] ?? "";

  // If running from a bun global install path, use bun
  if (execPath.includes(".bun") || execPath.includes(path.join("bun", "bin"))) {
    return { cmd: "bun", args: ["install", "-g", "koincode"] };
  }

  // Try to detect available package managers, preferring npm since it's most common
  const managers = ["npm", "bun", "yarn", "pnpm"] as const;
  for (const mgr of managers) {
    try {
      execSync(`${mgr} --version`, { stdio: "ignore" });
      return { cmd: mgr, args: ["install", "-g", "koincode"] };
    } catch {
      // not available
    }
  }

  return { cmd: "npm", args: ["install", "-g", "koincode"] };
}

function getElevatedHint(cmd: string): string {
  if (isWindows) {
    return `\nUpdate failed. If it's a permission error, re-open your terminal as Administrator and run:\n\n  ${cmd} install -g koincode\n\n`;
  }
  return `\nUpdate failed. If it's a permission error, run:\n\n  sudo ${cmd} install -g koincode\n\n`;
}

// Kill the background server — the next CLI launch must spawn the freshly installed binary.
function killServer(): void {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf-8").trim());
    if (pid) process.kill(pid, "SIGTERM");
  } catch {
    // Server may already be dead — ignore
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // PID file may not exist — ignore
  }
}

function runNpmUpdate(
  destroyRenderer: () => void,
  newVersion: string,
): void {
  destroyRenderer();

  const { cmd, args } = detectPackageManager();
  process.stdout.write(`\nInstalling koincode v${newVersion}...\n\n`);

  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: isWindows,
  });

  child.on("error", (err: NodeJS.ErrnoException) => {
    Sentry.captureException(err);
    process.stdout.write(`\nFailed to run ${cmd}: ${err.message}\n\n`);
    process.exit(1);
  });

  child.on("close", (code) => {
    if (code === 0) {
      // The background server is killed only after a confirmed success — a slow
      // or failed update shouldn't take down a working server (same rationale
      // as the --update path).
      killServer();
      process.stdout.write(
        `\nkoincode updated to v${newVersion} — run koincode to start the new version.\n\n`,
      );
      process.exit(0);
    } else {
      process.stdout.write(getElevatedHint(cmd));
      process.exit(1);
    }
  });
}

/**
 * In-app update — called from the /update command menu.
 * Tears down the TUI and installs, so the user sees install output in a raw
 * terminal. Routes to npm update or self-update based on install method.
 */
export function runUpdate(
  destroyRenderer: () => void,
  newVersion: string,
): void {
  const method = detectInstallMethod();
  if (method === "npm") {
    runNpmUpdate(destroyRenderer, newVersion);
  } else {
    destroyRenderer();
    process.stdout.write(`\nDownloading koincode v${newVersion}...\n`);
    const progress = createDownloadProgress();
    downloadSelfUpdate(newVersion, { onProgress: progress.onProgress }).then((result) => {
      progress.finish();
      if (result === "downloaded") {
        // Kill the old server only once the new binary is confirmed on disk.
        killServer();
        process.stdout.write(
          `\nkoincode updated to v${newVersion} — run koincode to start the new version.\n\n`,
        );
        process.exit(0);
      } else if (result === "permission-denied") {
        process.stdout.write(
          `\nPermission denied. Run:\n\n  sudo koincode --update\n\n`,
        );
        process.exit(1);
      } else {
        process.stdout.write(
          `\nUpdate failed. Try the manual install:\n\n  curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh\n\n`,
        );
        process.exit(1);
      }
    });
  }
}

/** Headless update — called from `koincode --update`. No TUI or server involved. */
export async function runCliUpdate(): Promise<void> {
  process.stdout.write("Checking for updates...\n");

  try {
    const newVersion = await checkForUpdate();
    if (!newVersion) {
      process.stdout.write(`Already on the latest version (v${currentVersion}).\n`);
      process.exit(0);
    }

    const method = detectInstallMethod();

    if (method === "npm") {
      const { cmd, args } = detectPackageManager();
      process.stdout.write(`Installing koincode v${newVersion}...\n\n`);

      const child = spawn(cmd, args, {
        stdio: "inherit",
        shell: isWindows,
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        process.stdout.write(`Failed to run ${cmd}: ${err.message}\n`);
        process.exit(1);
      });

      child.on("close", (code) => {
        if (code === 0) {
          // Stop the old background server so the next launch/request respawns from the freshly
          // installed binary — otherwise it lingers on the port and a new client reuses it
          // (the version-skew guard in server-manager.ts would eventually force a restart, but
          // killing it here stops it immediately). Only on success — a failed update shouldn't
          // take down a working server.
          killServer();
          process.stdout.write(
            `\nkoincode updated to v${newVersion} — run koincode to start the new version.\n`,
          );
        } else {
          process.stdout.write(getElevatedHint(cmd));
        }
        process.exit(code ?? 1);
      });
    } else {
      process.stdout.write(`Downloading koincode v${newVersion}...\n`);
      const progress = createDownloadProgress();
      const result = await downloadSelfUpdate(newVersion, {
        onProgress: progress.onProgress,
      });
      progress.finish();
      if (result === "downloaded") {
        // Stop the old server so the next launch respawns from the new binary (see the npm
        // branch above for the full rationale). Only on a confirmed successful download.
        killServer();
        process.stdout.write(
          `koincode updated to v${newVersion} — run koincode to start the new version.\n`,
        );
        process.exit(0);
      } else if (result === "permission-denied") {
        process.stdout.write(
          `Permission denied. Run:\n\n  sudo koincode --update\n\n`,
        );
        process.exit(1);
      } else {
        process.stdout.write(
          `Update failed. Try the manual install:\n\n  curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh\n\n`,
        );
        process.exit(1);
      }
    }
  } catch {
    process.stdout.write("Could not check for updates.\n");
    process.exit(1);
  }
}
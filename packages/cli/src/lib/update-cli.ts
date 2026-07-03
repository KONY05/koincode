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
    signal: AbortSignal.timeout(8000),
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

/**
 * Self-update for curl/iex installs. Downloads the new binary from GitHub
 * Releases and atomically replaces the current binary on disk.
 *
 * On Unix: writes to a temp file in the same directory, then renames over the
 * current binary (atomic on same filesystem).
 * On Windows: renames current to .old, moves new into place, deletes .old
 * (can't overwrite a running executable on Windows).
 */
export async function downloadSelfUpdate(
  newVersion: string,
): Promise<"downloaded" | "permission-denied" | "error"> {
  const binPath = process.execPath;
  const assetName = getBinaryAssetName();
  const url = `https://github.com/KONY05/koincode/releases/download/v${newVersion}/${assetName}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
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
  killServer();

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
 * Tears down the TUI and kills the background server before updating,
 * so the user sees install output in a raw terminal.
 * Routes to npm update or self-update based on install method.
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
    killServer();
    process.stdout.write(`\nDownloading koincode v${newVersion}...\n\n`);
    downloadSelfUpdate(newVersion).then((result) => {
      if (result === "downloaded") {
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
      const result = await downloadSelfUpdate(newVersion);
      if (result === "downloaded") {
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

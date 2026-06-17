import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

import { PID_FILE } from "@koincode/shared";
import { version as currentVersion } from "../../package.json";
import { Sentry } from "./sentry";

export { currentVersion };

const isWindows = process.platform === "win32";

// Returns the new version string if an update is available, null if already latest.
// Throws on network / registry error so the caller can show an appropriate message.
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

// Tears down the TUI, kills the background server, then runs the install command
// in the restored terminal so the user can see output and enter their password if needed.
export function runUpdate(destroyRenderer: () => void, newVersion: string): void {
  destroyRenderer();

  // Kill the background server — the next CLI launch must spawn the freshly installed binary.
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

import { spawn } from "child_process";
import fs from "fs";
import { PID_FILE } from "@koincode/shared";
import { version as currentVersion } from "../../package.json";

export { currentVersion };

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

// Tears down the TUI, kills the background server, then runs npm install -g koincode
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

  process.stdout.write(`\nInstalling koincode v${newVersion}...\n\n`);

  const child = spawn("npm", ["install", "-g", "koincode"], {
    stdio: "inherit",
  });

  child.on("error", (err: NodeJS.ErrnoException) => {
    process.stdout.write(`\nFailed to run npm: ${err.message}\n\n`);
    process.exit(1);
  });

  child.on("close", (code) => {
    if (code === 0) {
      process.stdout.write(
        `\nkoincode updated to v${newVersion} — run koincode to start the new version.\n\n`,
      );
      process.exit(0);
    } else {
      process.stdout.write(
        `\nUpdate failed. If it's a permission error, run:\n\n  sudo npm install -g koincode\n\n`,
      );
      process.exit(1);
    }
  });
}

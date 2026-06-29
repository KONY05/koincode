import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { readGlobalConfig, updateGlobalConfig } from "../utils/configs/global-config";

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ],
  linux: [],
  win32: [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
  ],
};

const PLAYWRIGHT_CACHE_UNIX = path.join(
  process.env.HOME ?? "~",
  ".cache",
  "ms-playwright",
);
const PLAYWRIGHT_CACHE_WIN = path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "~", "AppData", "Local"),
  "ms-playwright",
);
const PLAYWRIGHT_CACHE = process.platform === "win32" ? PLAYWRIGHT_CACHE_WIN : PLAYWRIGHT_CACHE_UNIX;

function findSystemChrome(): string | null {
  const platform = process.platform;
  const candidates = CHROME_PATHS[platform] ?? [];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  if (platform === "linux") {
    for (const bin of ["google-chrome", "google-chrome-stable"]) {
      try {
        const resolved = execSync(`which ${bin}`, { encoding: "utf-8", stdio: "pipe" }).trim();
        if (resolved) return resolved;
      } catch {
        // not found
      }
    }
  }

  if (platform === "win32") {
    try {
      const resolved = execSync("where chrome.exe", { encoding: "utf-8", stdio: "pipe" }).trim().split("\n")[0];
      if (resolved) return resolved;
    } catch {
      // not found
    }
  }

  return null;
}

function hasPlaywrightChromium(): boolean {
  try {
    if (!fs.existsSync(PLAYWRIGHT_CACHE)) return false;
    const entries = fs.readdirSync(PLAYWRIGHT_CACHE);
    return entries.some((e) => e.startsWith("chromium"));
  } catch {
    return false;
  }
}

export type BrowserResolution = {
  type: "chrome" | "playwright-cache" | "needs-download";
  chromePath?: string;
  channel?: string;
};

export function resolveBrowser(): BrowserResolution {
  const config = readGlobalConfig();
  const browser = config.browser;
  if (browser?.ready && browser.path) {
    if (fs.existsSync(browser.path)) {
      const isChrome = browser.path.toLowerCase().includes("chrome");
      return {
        type: isChrome ? "chrome" : "playwright-cache",
        chromePath: browser.path,
        channel: isChrome ? "chrome" : undefined,
      };
    }
  }

  const chrome = findSystemChrome();
  if (chrome) {
    updateGlobalConfig({ browser: { ready: true, path: chrome } });
    return { type: "chrome", chromePath: chrome, channel: "chrome" };
  }

  if (hasPlaywrightChromium()) {
    updateGlobalConfig({ browser: { ready: true, path: PLAYWRIGHT_CACHE } });
    return { type: "playwright-cache" };
  }

  return { type: "needs-download" };
}

export function markBrowserReady(browserPath: string): void {
  updateGlobalConfig({ browser: { ready: true, path: browserPath } });
}

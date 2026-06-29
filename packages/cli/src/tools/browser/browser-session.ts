import type { Browser, Page } from "playwright";
import { readGlobalConfig } from "../../utils/configs/global-config";
import { resolveBrowser } from "../../lib/browser-setup";

let browser: Browser | null = null;
let page: Page | null = null;
let currentSessionId: string | null = null;

type ConsoleLogEntry = { type: string; text: string; timestamp: number };
const consoleLogs: ConsoleLogEntry[] = [];

async function launchBrowser(): Promise<Browser> {
  const resolution = resolveBrowser();

  if (resolution.type === "needs-download") {
    throw new Error(
      "No browser found. Enable browser tools first with: koincode --enable-browser-tools\n" +
      "This will detect your system Chrome or prompt you to download Chromium.",
    );
  }

  const headless = readGlobalConfig().browser?.headless ?? false;
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. Install it with: bun add playwright",
    );
  }

  if (resolution.channel === "chrome") {
    return pw.chromium.launch({ headless, channel: "chrome" });
  }

  return pw.chromium.launch({ headless });
}

async function openFreshPage(): Promise<Page> {
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  page = await browser!.newPage();
  consoleLogs.length = 0;
  page.on("console", (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text(), timestamp: Date.now() });
  });
  return page;
}

export async function getPage(sessionId?: string): Promise<Page> {
  if (!browser) {
    browser = await launchBrowser();
  }

  if (sessionId && sessionId !== currentSessionId) {
    currentSessionId = sessionId;
    return openFreshPage();
  }

  if (!page || page.isClosed()) {
    return openFreshPage();
  }

  return page;
}

export async function closeBrowser(): Promise<void> {
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  page = null;
  consoleLogs.length = 0;
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  return [...consoleLogs];
}

export function clearConsoleLogs(): void {
  consoleLogs.length = 0;
}

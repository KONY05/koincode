import { chromium, type Browser, type Page } from "playwright";
import { readGlobalConfig } from "../../utils/configs/global-config";

let browser: Browser | null = null;
let page: Page | null = null;

type ConsoleLogEntry = { type: string; text: string; timestamp: number };
const consoleLogs: ConsoleLogEntry[] = [];

export async function getPage(): Promise<Page> {
  if (!browser) {
    const headless = readGlobalConfig().browserHeadless ?? false;
    browser = await chromium.launch({ headless });
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage();
    consoleLogs.length = 0;
    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text(), timestamp: Date.now() });
    });
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

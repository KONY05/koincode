import type { Browser } from "playwright";

import { toolInputSchemas } from "@koincode/shared";

const MAX_FETCH_SIZE = 300_000;

export async function runWebFetch(input: unknown) {
  const { url, timeout } = toolInputSchemas.webFetch.parse(input);

  let browser: Browser | undefined;
  try {
    let pw: typeof import("playwright");
    try {
      pw = await import("playwright");
    } catch {
      throw new Error(
        "Browser tools require the playwright package, which isn't available in this build.",
      );
    }

    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeout * 1000,
    });

    // Wait for client-side rendering to complete (Next.js hydration, etc.)
    await page.waitForTimeout(5000);

    const content = await page.content();
    await context.close();

    return content.length > MAX_FETCH_SIZE
      ? {
          content: content.slice(0, MAX_FETCH_SIZE),
          truncated: true,
          totalLength: content.length,
        }
      : { content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

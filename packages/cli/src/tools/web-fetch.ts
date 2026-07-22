import type { Browser } from "playwright";
import TurndownService from "turndown";

import { toolInputSchemas } from "@koincode/shared";

const MAX_FETCH_SIZE = 300_000;
// Below this amount of visible text in <body>, treat the page as an
// unrendered client-side app shell (e.g. `<div id="root">` + a JS bundle)
// rather than real content, and fall back to a real browser.
const UNRENDERED_TEXT_THRESHOLD = 200;

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndown.remove(["script", "style", "meta", "link"]);

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Tool results here are plain text handed back to the model — there's no
// pipeline for a tool call to inject an image/binary attachment into model
// messages (unlike the dedicated paste-image flow, see
// context/feature-specs/30-image-support-implementation.md). Decoding binary
// bytes as text would just hand the model mangled garbage, so detect it and
// say so instead.
function isTextLike(contentType: string): boolean {
  if (contentType.startsWith("text/")) return true;
  return /json|xml|javascript|yaml|csv|html/i.test(contentType);
}

function extractBodyText(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch?.[1] ?? html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksUnrendered(html: string): boolean {
  // Heuristic: if the visible text in the <body> is below this threshold, assume
  // it's an unrendered client-side app shell and use a browser for full rendering.
  return extractBodyText(html).length < UNRENDERED_TEXT_THRESHOLD;
}

function truncateContent(content: string) {
  return content.length > MAX_FETCH_SIZE
    ? { content: content.slice(0, MAX_FETCH_SIZE), truncated: true, totalLength: content.length }
    : { content };
}

async function fetchWithBrowser(url: string, timeout: number) {
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
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeout * 1000 });

    // Best-effort wait for client-side rendering (Next.js hydration, etc.):
    // resolve early if the page goes network-idle, but don't wait past the
    // same 5s budget the old flat wait used — plenty of real pages (analytics
    // beacons, websockets, polling) never go idle, and `networkidle` would
    // otherwise burn the full request timeout waiting for something that
    // never happens.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const html = await page.content();
    await context.close();

    return truncateContent(turndown.turndown(html));
  } finally {
    if (browser) await browser.close();
  }
}

export async function runWebFetch(input: unknown) {
  const { url, timeout } = toolInputSchemas.webFetch.parse(input);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return { error: `Request failed with status ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!isTextLike(contentType)) {
      const buffer = await response.arrayBuffer();
      return {
        error: `Response is binary content (${contentType || "unknown type"}, ${buffer.byteLength} bytes) — this tool only returns text/markdown content.`,
      };
    }

    const body = await response.text();

    if (!contentType.includes("html")) {
      return truncateContent(body);
    }

    if (looksUnrendered(body)) {
      return await fetchWithBrowser(url, timeout);
    }

    return truncateContent(turndown.turndown(body));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

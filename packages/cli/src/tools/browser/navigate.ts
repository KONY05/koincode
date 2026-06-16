import { toolInputSchemas } from "@koincode/shared";
import { getPage } from "./browser-session";

export async function runBrowserNavigate(input: unknown, sessionId?: string) {
  const { url, waitUntil } = toolInputSchemas.browserNavigate.parse(input);
  const page = await getPage(sessionId);
  await page.goto(url, { waitUntil });
  const title = await page.title();
  return { url, title };
}

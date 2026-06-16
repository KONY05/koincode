import { toolInputSchemas } from "@koincode/shared";
import { getPage } from "./browser-session";

export async function runBrowserClick(input: unknown, sessionId?: string) {
  const { selector } = toolInputSchemas.browserClick.parse(input);
  const page = await getPage(sessionId);
  await page.click(selector);
  return { clicked: selector };
}

import { toolInputSchemas } from "@koincode/shared";
import { getPage } from "./browser-session";

export async function runBrowserType(input: unknown, sessionId?: string) {
  const { selector, text, clearFirst } =
    toolInputSchemas.browserType.parse(input);
  const page = await getPage(sessionId);
  if (clearFirst) {
    await page.fill(selector, text);
  } else {
    await page.locator(selector).pressSequentially(text);
  }
  return { typed: text, into: selector };
}

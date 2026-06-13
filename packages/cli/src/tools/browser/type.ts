import { toolInputSchemas } from "@koincode/shared";
import { getPage } from "./session";

export async function runBrowserType(input: unknown) {
  const { selector, text, clearFirst } = toolInputSchemas.browserType.parse(input);
  const page = await getPage();
  if (clearFirst) {
    await page.fill(selector, text);
  } else {
    await page.locator(selector).pressSequentially(text);
  }
  return { typed: text, into: selector };
}

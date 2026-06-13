import { toolInputSchemas } from "@koincode/shared";
import { getPage } from "./session";

export async function runBrowserClick(input: unknown) {
  const { selector } = toolInputSchemas.browserClick.parse(input);
  const page = await getPage();
  await page.click(selector);
  return { clicked: selector };
}

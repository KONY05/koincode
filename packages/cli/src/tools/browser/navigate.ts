import { toolInputSchemas } from "@koincode/shared";
import { getPage } from "./session";

export async function runBrowserNavigate(input: unknown) {
  const { url, waitUntil } = toolInputSchemas.browserNavigate.parse(input);
  const page = await getPage();
  await page.goto(url, { waitUntil });
  const title = await page.title();
  return { url, title };
}

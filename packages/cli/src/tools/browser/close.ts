import { closeBrowser } from "./browser-session";

export async function runBrowserClose(_input: unknown) {
  await closeBrowser();
  return { closed: true };
}

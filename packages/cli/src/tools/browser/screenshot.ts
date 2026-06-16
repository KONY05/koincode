import { toolInputSchemas, isVisionModel } from "@koincode/shared";
import { getPage } from "./browser-session";

type ImagePart = { type: "image"; data: string; mimeType: "image/jpeg" };
type TextPart = { type: "text"; text: string };

export async function runBrowserScreenshot(
  input: unknown,
  modelId?: string,
  sessionId?: string,
): Promise<(ImagePart | TextPart)[]> {
  const { fullPage } = toolInputSchemas.browserScreenshot.parse(input);
  const page = await getPage(sessionId);

  const url = page.url();
  const title = await page.title();
  const bodyText = await page
    .evaluate<string>("document.body?.innerText ?? ''")
    .catch(() => "");
  const pageText = `URL: ${url}\nTitle: ${title}\n\nPage text:\n${bodyText.slice(0, 2000)}`;

  if (modelId && isVisionModel(modelId)) {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 85,
      fullPage,
    });
    const base64 = buffer.toString("base64");
    return [
      { type: "image", data: base64, mimeType: "image/jpeg" },
      { type: "text", text: pageText },
    ];
  }

  return [{ type: "text", text: pageText }];
}

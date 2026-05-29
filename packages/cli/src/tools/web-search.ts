import { toolInputSchemas } from "@koincode/shared";

function decodeDdgUrl(href: string): string {
  try {
    const full = href.startsWith("//") ? `https:${href}` : href;
    const uddg = new URL(full).searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDdgResults(
  html: string,
  maxResults: number,
): { title: string; url: string; snippet: string }[] {
  const results: { title: string; url: string; snippet: string }[] = [];

  const titleRe = /<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a\b[^>]*\bclass="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const titles: { url: string; text: string }[] = [];
  const snippets: string[] = [];

  let m: RegExpExecArray | null;

  while ((m = titleRe.exec(html)) !== null && titles.length < maxResults) {
    const hrefMatch = m[1]!.match(/href="([^"]*)"/);
    if (hrefMatch) {
      titles.push({ url: decodeDdgUrl(hrefMatch[1]!), text: m[2]! });
    }
  }

  while ((m = snippetRe.exec(html)) !== null && snippets.length < maxResults) {
    snippets.push(m[1]!);
  }

  for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
    results.push({
      title: decodeHtmlEntities(titles[i]!.text),
      url: titles[i]!.url,
      snippet: decodeHtmlEntities(snippets[i] ?? ""),
    });
  }

  return results;
}

export async function runWebSearch(input: unknown) {
  const { query, maxResults = 10 } = toolInputSchemas.webSearch.parse(input);

  const body = new URLSearchParams({ q: query, b: "", kl: "" });
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
      Accept: "text/html,application/xhtml+xml",
    },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);

  const html = await response.text();
  return { results: parseDdgResults(html, maxResults) };
}

import { toolInputSchemas } from "@koincode/shared";

const MAX_FETCH_SIZE = 50_000;

export async function runWebFetch(input: unknown) {
  const { url, timeout } = toolInputSchemas.webFetch.parse(input);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const text = await res.text();
    return text.length > MAX_FETCH_SIZE
      ? { content: text.slice(0, MAX_FETCH_SIZE), truncated: true, totalLength: text.length }
      : { content: text };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  } finally {
    clearTimeout(timer);
  }
}

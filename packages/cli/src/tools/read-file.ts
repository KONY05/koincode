import { readFile } from "fs/promises";
import { extname } from "path";

import { MAX_FILE_SIZE, resolveFromCwd } from "./utils";
import { toolInputSchemas } from "@koincode/shared";

/**
 * PDF/DOCX are extracted to plain text rather than sent to the model as raw
 * bytes — every model already handles plain text, so this needs no model
 * capability check (unlike images, which require a vision-capable model to
 * read the pixels directly). Loses visual layout/embedded images; that
 * trade-off is deliberate for a text-focused coding agent.
 */
async function extractFileContent(resolved: string): Promise<string> {
  const ext = extname(resolved).toLowerCase();

  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");

    const buffer = await readFile(resolved);

    const pdf = await getDocumentProxy(new Uint8Array(buffer));

    const { text } = await extractText(pdf, { mergePages: true });

    return text;
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");

    const buffer = await readFile(resolved);

    const { value } = await mammoth.extractRawText({ buffer });
    
    return value;
  }

  return readFile(resolved, "utf-8");
}

export async function runReadFile(input: unknown) {
  const { path, offset = 0, limit = MAX_FILE_SIZE } = toolInputSchemas.readFile.parse(input);

  const { resolved } = resolveFromCwd(path);

  const content = await extractFileContent(resolved);

  const chunk = content.slice(offset, offset + limit);

  const hasMore = offset + limit < content.length;
  
  return hasMore
    ? { content: chunk, truncated: true, totalLength: content.length, nextOffset: offset + limit }
    : { content: chunk, totalLength: content.length };
}

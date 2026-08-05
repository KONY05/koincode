import { open, readFile, stat } from "fs/promises";
import { basename, extname } from "path";


import { findUnsurfacedAgentsMd, formatWorkspacePath, MAX_FILE_SIZE, resolveFromCwd } from "./utils";
import { toolInputSchemas, isVisionModel, type WorkspaceRoot, type ImageFileResult } from "@koincode/shared";

/** Default line budget per read; MAX_FILE_SIZE still caps the payload in characters. */
const MAX_READ_LINES = 2_000;

/** Individual lines longer than this are truncated in place rather than blowing the whole read's budget. */
const MAX_LINE_LENGTH = 2_000;
const lineTruncatedSuffix = (cap: number, isSingleLineRequest: boolean) =>
  isSingleLineRequest
    ? `... (line truncated to ${cap} chars — this is the line's full available content; use grep or shell to inspect further)`
    : `... (line truncated to ${cap} chars — re-read this line alone with limit: 1 to see more of it)`;

const SAMPLE_BYTES = 4_096;

// Image formats a vision-capable model can read directly via base64 attachment.
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 10 MB — matches the cap used in use-image-attachment.ts for user-attached images. */
const IMAGE_MAX_SIZE = 10 * 1024 * 1024;

// Formats/containers a text-focused agent has no business decoding as utf-8 — doing so
// silently produces mojibake in the model's context instead of a clear error.
const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".war", ".wasm",
  ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".pyc", ".pyo",
  ".bmp", ".ico",
  ".mp3", ".mp4", ".mov", ".avi", ".wav", ".flac",
  ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
]);

async function readSample(resolved: string, size: number): Promise<Buffer> {
  if (size === 0) return Buffer.alloc(0);

  const handle = await open(resolved, "r");
  try {
    const buffer = Buffer.alloc(Math.min(SAMPLE_BYTES, size));
    await handle.read(buffer, 0, buffer.length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

// Null byte anywhere, or a large share of non-printable bytes, means this isn't text —
// mirrors the heuristic most editors/tools use to flag a file as binary.
function looksBinary(sample: Buffer): boolean {
  if (sample.length === 0) return false;

  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
  }

  return nonPrintable / sample.length > 0.3;
}

/**
 * PDF/DOCX are extracted to plain text rather than sent to the model as raw
 * bytes — every model already handles plain text, so this needs no model
 * capability check (unlike images, which require a vision-capable model to
 * read the pixels directly). Loses visual layout/embedded images; that
 * trade-off is deliberate for a text-focused coding agent.
 */
async function extractFileContent(resolved: string, modelId?: string): Promise<string | ImageFileResult> {
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

  if (IMAGE_EXTENSIONS.has(ext)) {
    const fileStat = await stat(resolved);
    if (fileStat.size > IMAGE_MAX_SIZE) {
      throw new Error(`Image file is too large to read (${(fileStat.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
    }
    if (!modelId || !isVisionModel(modelId)) {
      throw new Error(`Cannot read image file: the active model does not support vision.`);
    }
    const buffer = await readFile(resolved);
    const mediaType = IMAGE_MIME_TYPES[ext] ?? "application/octet-stream";
    return {
      isImage: true,
      path: "", // filled in by runReadFile after formatWorkspacePath
      mediaType,
      data: buffer.toString("base64"),
      filename: basename(resolved),
      summary: `${mediaType} · ${(fileStat.size / 1024).toFixed(0)} KB`,
    };
  }

  const fileStat = await stat(resolved);
  if (BINARY_EXTENSIONS.has(ext) || looksBinary(await readSample(resolved, fileStat.size))) {
    throw new Error(`Cannot read binary file: ${resolved}`);
  }

  return readFile(resolved, "utf-8");
}

export async function runReadFile(
  input: unknown,
  roots: WorkspaceRoot[] = [],
  alreadyLoadedAgentsMd: Map<string, string> = new Map(),
  modelId?: string,
) {
  const { path, offset = 1, limit = MAX_READ_LINES } = toolInputSchemas.readFile.parse(input);

  const { resolved } = resolveFromCwd(path);
  const displayPath = formatWorkspacePath(resolved, roots);

  const content = await extractFileContent(resolved, modelId);

  // Image: return the ImageFileResult directly — no line-numbering or pagination.
  if (typeof content === "object" && content.isImage) {
    return { ...content, path: displayPath };
  }

  // An empty file has zero lines, not one — "".split("\n") would otherwise yield [""].
  const lines = (content as string).length === 0 ? [] : (content as string).split("\n");

  // A trailing newline yields a final "" element that isn't a real line — dropping it keeps
  // totalLines matching what an editor shows, so line numbers here line up with the user's.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const totalLines = lines.length;

  if (totalLines < offset && !(totalLines === 0 && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for this file (${totalLines} lines)`);
  }

  const startLine = offset;
  const requested = lines.slice(startLine - 1, startLine - 1 + limit);

  // Line count alone can't bound context — a handful of minified lines can blow past any
  // sane budget — so MAX_FILE_SIZE still caps the payload, trimming whole lines off the end.
  // Each line is also capped at MAX_LINE_LENGTH first, so one oversized line can never stall
  // pagination by consuming the entire budget itself. Exception: a request scoped to exactly
  // one line is a deliberate ask to see that line in full (e.g. after it got truncated in a
  // wider read) — skip the per-line cap and let it run up to MAX_FILE_SIZE instead.
  const singleLineRequest = limit === 1;

  const included: string[] = [];
  let chars = 0;
  for (const rawLine of requested) {
    const cap = singleLineRequest ? MAX_FILE_SIZE : MAX_LINE_LENGTH;
    const line = rawLine.length > cap ? rawLine.slice(0, cap) + lineTruncatedSuffix(cap, singleLineRequest) : rawLine;
    if (included.length > 0 && chars + line.length + 1 > MAX_FILE_SIZE) break;
    included.push(line);
    chars += line.length + 1;
  }

  const endLine = startLine + included.length - 1;

  const hasMore = endLine < totalLines;

  // Numbered like `cat -n`, matching the convention the model already expects from the
  // harness's own Read tool — lets it cite an exact line instead of counting manually.
  const chunk = included.map((line, i) => `${startLine + i}: ${line}`).join("\n");

  // Content itself, not just paths — extractLoadedAgentsMd compares against this on later
  // calls, so an edit to an already-surfaced AGENTS.md gets picked up instead of the model
  // being stuck with whatever was shown the first time.
  const loadedAgentsMd = findUnsurfacedAgentsMd(resolved, roots, alreadyLoadedAgentsMd);
  const reminder =
    loadedAgentsMd.length > 0
      ? `\n\n<system-reminder>\n${loadedAgentsMd.map((f) => `Instructions from: ${f.path}\n${f.content}`).join("\n\n")}\n</system-reminder>`
      : "";

  return {
    ...(hasMore
      ? { path: displayPath, content: chunk + reminder, truncated: true, totalLines, nextOffset: endLine + 1, startLine, endLine }
      : { path: displayPath, content: chunk + reminder, totalLines, startLine, endLine }),
    loadedAgentsMd,
  };
}

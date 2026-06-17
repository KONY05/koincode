import { readFile, stat } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { useRef, useCallback } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { isVisionModel, IMAGE_PLACEHOLDER_RE } from "@koincode/shared";
import { apiClient } from "../lib/api-client";
import { useToast } from "../providers/toast";

const CURRENT_DIRECTORY = process.cwd();

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const IMAGE_PATH_RE = /(?:^|\s)((?:\/|\.\/|~\/|\.\.\/)?[^\s]+\.(?:png|jpe?g|gif|webp))(?=\s|$)/gi;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

type ImageEntry = { base64: string; mimeType: string; filename: string };

function resolveImagePath(raw: string): string {
  if (raw.startsWith("~/")) {
    return resolve(process.env.HOME ?? "/", raw.slice(2));
  }
  return resolve(CURRENT_DIRECTORY, raw);
}

async function tryReadImage(filePath: string): Promise<ImageEntry | null> {
  try {
    const resolved = resolveImagePath(filePath);
    const ext = extname(resolved).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return null;

    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) return null;
    if (fileStat.size > MAX_IMAGE_SIZE_BYTES) return null;

    const buffer = await readFile(resolved);
    return {
      base64: buffer.toString("base64"),
      mimeType: MIME_TYPES[ext] ?? "application/octet-stream",
      filename: basename(resolved),
    };
  } catch {
    return null;
  }
}

type UseImageAttachmentOptions = {
  textareaRef: React.RefObject<TextareaRenderable | null>;
  skipUndoRef: React.RefObject<boolean>;
};

export function useImageAttachment({ textareaRef, skipUndoRef }: UseImageAttachmentOptions) {
  const processingRef = useRef<Set<string>>(new Set());
  const toast = useToast();

  const detectAndReplaceImagePaths = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    IMAGE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    const replacements: { start: number; end: number; path: string }[] = [];

    while ((match = IMAGE_PATH_RE.exec(text)) !== null) {
      const fullMatch = match[0]!;
      const filePath = match[1]!;
      const leadingWhitespace = fullMatch.length - filePath.length;
      const start = match.index + leadingWhitespace;
      const end = start + filePath.length;

      if (processingRef.current.has(filePath)) continue;

      replacements.push({ start, end, path: filePath });
    }

    if (replacements.length === 0) return;

    for (const { path } of replacements) {
      processingRef.current.add(path);
    }

    void (async () => {
      const resolved: { path: string; id: string; filename: string }[] = [];

      for (const rep of replacements) {
        const entry = await tryReadImage(rep.path);
        if (entry) {
          try {
            const res = await apiClient.images.$post({
              json: { base64: entry.base64, mimeType: entry.mimeType, filename: entry.filename },
            });
            if (res.ok) {
              const { id } = await res.json();
              resolved.push({ path: rep.path, id, filename: entry.filename });
            }
          } catch {
            // Server unreachable — leave path as text
          }
        }
        processingRef.current.delete(rep.path);
      }

      if (resolved.length === 0) return;

      const ta = textareaRef.current;
      if (!ta) return;

      let currentText = ta.plainText;
      let offset = 0;

      for (const { path, id } of resolved) {
        const idx = currentText.indexOf(path, offset);
        if (idx === -1) continue;

        const placeholder = `[#image:${id}]`;

        skipUndoRef.current = true;
        const before = currentText.slice(0, idx);
        const after = currentText.slice(idx + path.length);
        currentText = before + placeholder + after;
        ta.replaceText(currentText);
        ta.cursorOffset = idx + placeholder.length;
        skipUndoRef.current = false;

        offset = idx + placeholder.length;
      }

      // if (resolved.length === 1) {
      //   toast.show({ message: `Image attached: ${resolved[0]!.filename}`, variant: "info" });
      // } else if (resolved.length > 1) {
      //   toast.show({ message: `${resolved.length} images attached`, variant: "info" });
      // }
    })();
  }, [textareaRef, skipUndoRef]);

  const hasImageTags = useCallback((text: string): boolean => {
    IMAGE_PLACEHOLDER_RE.lastIndex = 0;
    const result = IMAGE_PLACEHOLDER_RE.test(text);
    IMAGE_PLACEHOLDER_RE.lastIndex = 0;
    return result;
  }, []);

  const checkVisionModel = useCallback((model: string): boolean => {
    if (!isVisionModel(model)) {
      toast.show({
        message: "This model does not support images. Switch to a vision-capable model or remove images to send.",
        variant: "error",
      });
      return false;
    }
    return true;
  }, [toast]);

  return { detectAndReplaceImagePaths, hasImageTags, checkVisionModel };
}

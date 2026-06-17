import { useRef, useEffect, useCallback } from "react";
import type { PasteEvent } from "@opentui/core";
import { decodePasteBytes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";

const PASTE_THRESHOLD_LINES = 5;
const PASTE_THRESHOLD_CHARS = 200;
const PASTE_PLACEHOLDER_RE = /\[paste:(p\d+): [^\]]+\]/g;

type UsePasteHandlerOptions = {
  textareaRef: React.RefObject<TextareaRenderable | null>;
};

export function usePasteHandler({ textareaRef }: UsePasteHandlerOptions) {
  const counterRef = useRef(0);
  const contentRef = useRef<Map<string, string>>(new Map());
  const renderer = useRenderer();

  useEffect(() => {
    const internalKeyInput = renderer._internalKeyInput;

    const handlePaste = (event: PasteEvent) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const text = decodePasteBytes(event.bytes);
      const lines = text.split("\n");
      const isLong =
        lines.length > PASTE_THRESHOLD_LINES ||
        text.length > PASTE_THRESHOLD_CHARS;

      if (!isLong) return;

      event.preventDefault();

      const id = `p${++counterRef.current}`;
      contentRef.current.set(id, text);

      const label =
        lines.length > PASTE_THRESHOLD_LINES
          ? `${lines.length} lines`
          : `${text.length} chars`;

      textarea.insertText(`[paste:${id}: ${label}]`);
    };

    internalKeyInput.on("paste", handlePaste);
    return () => {
      internalKeyInput.off("paste", handlePaste);
    };
  }, [renderer, textareaRef]);

  const expandPastes = useCallback((raw: string): string => {
    return raw.replace(PASTE_PLACEHOLDER_RE, (_, id: string) => {
      return contentRef.current.get(id) ?? "";
    });
  }, []);

  const clearPastes = useCallback(() => {
    contentRef.current.clear();
  }, []);

  return { expandPastes, clearPastes };
}

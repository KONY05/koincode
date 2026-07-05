import { useState, useEffect, useCallback } from "react";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { IDE_CONTEXT_FILE, GLOBAL_CONFIG_DIR } from "@koincode/shared";

export type IdeSelection = {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
};

type IdeContext = {
  activeFile: string | null;
  selection: IdeSelection | null;
};

// Module-level state so use-chat can read the current value without React.
let _activeFile: string | null = null;
let _enabled = true;
let _selection: IdeSelection | null = null;
let _selectionEnabled = true;

// Notified when a submit consumes the selection, so the status bar indicator
// (owned by React state in useIdeContext) clears immediately instead of
// waiting for the extension to rewrite the context file.
const selectionConsumedListeners = new Set<() => void>();

/** Returns the active file path to inject into the chat request, or null if disabled/unavailable. */
export function getIdeContextForRequest(): string | null {
  return _enabled ? _activeFile : null;
}

/**
 * Returns the current selection to inject into the chat request, then
 * consumes it — clears module state and notifies subscribers — so it is
 * only ever sent once. A new (or changed) selection is required before it
 * can be attached again.
 */
export function getIdeSelectionForRequest(): IdeSelection | null {
  if (!_selectionEnabled || !_selection) return null;
  const selection = _selection;
  _selection = null;
  for (const listener of selectionConsumedListeners) listener();
  return selection;
}

function parseContextFile(raw: string): IdeContext {
  try {
    const data = JSON.parse(raw) as { activeFile?: unknown; selection?: unknown };
    const rawSelection = data.selection as
      | { file?: unknown; startLine?: unknown; endLine?: unknown; text?: unknown }
      | null
      | undefined;
    const selection: IdeSelection | null =
      rawSelection &&
      typeof rawSelection.file === "string" &&
      typeof rawSelection.startLine === "number" &&
      typeof rawSelection.endLine === "number" &&
      typeof rawSelection.text === "string"
        ? {
            file: rawSelection.file,
            startLine: rawSelection.startLine,
            endLine: rawSelection.endLine,
            text: rawSelection.text,
          }
        : null;
    return {
      activeFile: typeof data.activeFile === "string" ? data.activeFile : null,
      selection,
    };
  } catch {
    return { activeFile: null, selection: null };
  }
}

async function readIdeContext(): Promise<IdeContext> {
  try {
    const raw = await readFile(IDE_CONTEXT_FILE, "utf8");
    return parseContextFile(raw);
  } catch {
    return { activeFile: null, selection: null };
  }
}

type IdeContextResult = {
  activeFile: string | null;
  fileContextEnabled: boolean;
  toggleFileContext: () => void;
  selection: IdeSelection | null;
  selectionContextEnabled: boolean;
  toggleSelectionContext: () => void;
};

export function useIdeContext(): IdeContextResult {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContextEnabled, setFileContextEnabled] = useState(true);
  const [selection, setSelection] = useState<IdeSelection | null>(null);
  const [selectionContextEnabled, setSelectionContextEnabled] = useState(true);

  const toggleFileContext = useCallback(() => {
    setFileContextEnabled((prev) => {
      _enabled = !prev;
      return !prev;
    });
  }, []);

  const toggleSelectionContext = useCallback(() => {
    setSelectionContextEnabled((prev) => {
      _selectionEnabled = !prev;
      return !prev;
    });
  }, []);

  useEffect(() => {
    if (process.env.TERM_PROGRAM !== "vscode") return;

    async function update() {
      const ctx = await readIdeContext();
      const file = ctx.activeFile ? basename(ctx.activeFile) : null;
      _activeFile = ctx.activeFile;
      _selection = ctx.selection;
      setActiveFile(file);
      setSelection(ctx.selection);
    }

    void update();

    // Watch the directory so we pick up changes even before the file exists.
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(GLOBAL_CONFIG_DIR, (_, filename) => {
        if (filename !== "ide-context.json") return;
        void update();
      });
    } catch {
      // ~/.koincode not yet created — no watcher; extension will create the dir when it first runs
    }

    const onConsumed = () => setSelection(null);
    selectionConsumedListeners.add(onConsumed);

    return () => {
      watcher?.close();
      selectionConsumedListeners.delete(onConsumed);
    };
  }, []);

  return {
    activeFile,
    fileContextEnabled,
    toggleFileContext,
    selection,
    selectionContextEnabled,
    toggleSelectionContext,
  };
}

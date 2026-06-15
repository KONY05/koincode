import { useState, useEffect, useCallback } from "react";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { IDE_CONTEXT_FILE, GLOBAL_CONFIG_DIR } from "@koincode/shared";

type IdeContext = {
  activeFile: string | null;
};

// Module-level state so use-chat can read the current value without React.
let _activeFile: string | null = null;
let _enabled = true;

/** Returns the active file path to inject into the chat request, or null if disabled/unavailable. */
export function getIdeContextForRequest(): string | null {
  return _enabled ? _activeFile : null;
}

function parseContextFile(raw: string): IdeContext {
  try {
    const data = JSON.parse(raw) as { activeFile?: unknown };
    return {
      activeFile: typeof data.activeFile === "string" ? data.activeFile : null,
    };
  } catch {
    return { activeFile: null };
  }
}

async function readIdeContext(): Promise<IdeContext> {
  try {
    const raw = await readFile(IDE_CONTEXT_FILE, "utf8");
    return parseContextFile(raw);
  } catch {
    return { activeFile: null };
  }
}

type IdeContextResult = {
  activeFile: string | null;
  fileContextEnabled: boolean;
  toggleFileContext: () => void;
};

export function useIdeContext(): IdeContextResult {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContextEnabled, setFileContextEnabled] = useState(true);

  const toggleFileContext = useCallback(() => {
    setFileContextEnabled((prev) => {
      _enabled = !prev;
      return !prev;
    });
  }, []);

  useEffect(() => {
    if (process.env.TERM_PROGRAM !== "vscode") return;

    async function update() {
      const ctx = await readIdeContext();
      const file = ctx.activeFile ? basename(ctx.activeFile) : null;
      _activeFile = ctx.activeFile;
      setActiveFile(file);
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

    return () => {
      watcher?.close();
    };
  }, []);

  return { activeFile, fileContextEnabled, toggleFileContext };
}

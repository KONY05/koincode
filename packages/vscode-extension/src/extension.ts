import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Deliberately not imported from @koincode/shared: that package's package.json
// exports raw .ts source with no compiled output, resolvable only under Bun's
// runtime/resolver — never under the plain Node.js the VS Code extension host
// actually runs on. Keep these in sync with packages/shared/src/paths.ts by hand.
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".koincode");
const IDE_CONTEXT_FILE = path.join(GLOBAL_CONFIG_DIR, "ide-context.json");
const NOTIFY_REQUEST_FILE = path.join(GLOBAL_CONFIG_DIR, "notify-request.json");

// Selected text is capped so a huge selection can't balloon the context file
// (and, downstream, the chat request body) — truncated with a marker instead
// of dropped entirely.
const MAX_SELECTION_CHARS = 20_000;

type SelectionInfo = {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
} | null;

// Both fields live in one file, so they're tracked in memory and written
// together — writing just one would clobber whichever field changed most
// recently on the other axis.
let currentActiveFile: string | null = null;
let currentSelection: SelectionInfo = null;

function writeIdeContext(): void {
  try {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      IDE_CONTEXT_FILE,
      JSON.stringify({ activeFile: currentActiveFile, selection: currentSelection }),
    );
  } catch {
    // Non-fatal — the status bar just won't update.
  }
}

function setActiveFile(filePath: string | null): void {
  currentActiveFile = filePath;
  writeIdeContext();
}

function setSelection(editor: vscode.TextEditor | undefined): void {
  if (!editor || editor.selection.isEmpty) {
    currentSelection = null;
  } else {
    let text = editor.document.getText(editor.selection);
    if (text.length > MAX_SELECTION_CHARS) {
      text = `${text.slice(0, MAX_SELECTION_CHARS)}...truncated`;
    }
    currentSelection = {
      file: editor.document.fileName,
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
      text,
    };
  }
  writeIdeContext();
}

// Fallback for terminals that ignore BEL (VS Code's integrated terminal does,
// unless the user opts into a bell setting). The CLI writes a notify request
// here when it wants the user's attention; we relay it as an in-editor toast.
// `lastNotifiedAt` starts at activation time so a stale leftover file from a
// previous session never fires immediately on startup.
let lastNotifiedAt = Date.now();

function checkNotifyRequest(): void {
  try {
    const raw = fs.readFileSync(NOTIFY_REQUEST_FILE, "utf8");
    const data = JSON.parse(raw) as { message?: unknown; at?: unknown };
    if (
      typeof data.message === "string" &&
      typeof data.at === "number" &&
      data.at > lastNotifiedAt
    ) {
      lastNotifiedAt = data.at;
      void vscode.window.showInformationMessage(data.message);
    }
  } catch {
    // No request file yet, or it was malformed — nothing to show.
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // Write whatever is open (and selected) right now on activation.
  setActiveFile(vscode.window.activeTextEditor?.document.fileName ?? null);
  setSelection(vscode.window.activeTextEditor);

  const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
    setActiveFile(editor?.document.fileName ?? null);
    setSelection(editor);
  });
  context.subscriptions.push(activeEditorDisposable);

  const selectionDisposable = vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
    if (e.textEditor !== vscode.window.activeTextEditor) return; // ignore inactive panes
    setSelection(e.textEditor);
  });
  context.subscriptions.push(selectionDisposable);

  try {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    const watcher = fs.watch(GLOBAL_CONFIG_DIR, (_event: fs.WatchEventType, filename: string | Buffer | null) => {
      if (filename !== "notify-request.json") return;
      checkNotifyRequest();
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // Non-fatal — notifications just won't relay through the editor.
  }
}

export function deactivate(): void {
  currentActiveFile = null;
  currentSelection = null;
  writeIdeContext();
}

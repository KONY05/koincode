import * as vscode from "vscode";
import * as fs from "node:fs";

import { IDE_CONTEXT_FILE, GLOBAL_CONFIG_DIR } from "@koincode/shared";

function writeActiveFile(filePath: string | null): void {
  try {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      IDE_CONTEXT_FILE,
      JSON.stringify({ activeFile: filePath }),
    );
  } catch {
    // Non-fatal — the status bar just won't update.
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // Write whatever is open right now on activation.
  writeActiveFile(vscode.window.activeTextEditor?.document.fileName ?? null);

  const disposable = vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
    writeActiveFile(editor?.document.fileName ?? null);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  writeActiveFile(null);
}

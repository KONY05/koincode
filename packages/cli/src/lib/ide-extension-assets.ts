/**
 * Embedded VS Code extension assets — the extension package.json and compiled
 * extension.js inlined as strings so they can be extracted to disk at runtime.
 *
 * This avoids a filesystem dependency on dist/vscode-extension/ and works
 * identically across compiled binaries, npm installs, and curl/iex installs.
 *
 * When the extension source changes, rebuild it (bun run --cwd packages/vscode-extension build)
 * and update these constants.
 */

export const EXTENSION_VERSION = "0.1.0";

export const EXTENSION_PACKAGE_JSON = JSON.stringify(
  {
    name: "koincode-vscode",
    displayName: "KOINCODE",
    description:
      "IDE context bridge for KOINCODE — surfaces the active file in the terminal agent status bar.",
    version: EXTENSION_VERSION,
    engines: { vscode: "^1.80.0" },
    categories: ["Other"],
    activationEvents: ["onStartupFinished"],
    main: "./out/extension.js",
    contributes: {},
  },
  null,
  2,
);

export const EXTENSION_JS = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const KOINCODE_DIR = path.join(os.homedir(), ".koincode");
const IDE_CONTEXT_FILE = path.join(KOINCODE_DIR, "ide-context.json");
function writeActiveFile(filePath) {
  try {
    fs.mkdirSync(KOINCODE_DIR, { recursive: true });
    fs.writeFileSync(IDE_CONTEXT_FILE, JSON.stringify({ activeFile: filePath }));
  } catch {}
}
function activate(context) {
  writeActiveFile(vscode.window.activeTextEditor?.document.fileName ?? null);
  const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    writeActiveFile(editor?.document.fileName ?? null);
  });
  context.subscriptions.push(disposable);
}
function deactivate() {
  writeActiveFile(null);
}
`;

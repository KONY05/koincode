/**
 * On CLI startup, extracts the embedded VS Code extension into every known
 * editor's extensions folder (VS Code, Cursor, Windsurf, etc.). The extension
 * writes ~/.koincode/ide-context.json with the active file path, which the
 * CLI's status bar reads to show "In <filename>".
 *
 * Assets are embedded as string constants in ide-extension-assets.ts so this
 * works across compiled binaries, npm installs, and curl/iex installs without
 * depending on files in dist/.
 */

import path from "node:path";
import fs from "node:fs";
import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { GLOBAL_CONFIG_DIR } from "@koincode/shared";

import {
  EXTENSION_VERSION,
  EXTENSION_PACKAGE_JSON,
  EXTENSION_JS,
} from "./ide-extension-assets";

const EXTENSION_NAME = "koincode-vscode";

const KNOWN_EXTENSION_DIRS = [
  path.join(homedir(), ".antigravity", "extensions"),   // Antigravity
  path.join(homedir(), ".antigravity-ide", "extensions"),   // Antigravity
  path.join(homedir(), ".cursor", "extensions"),         // Cursor
  path.join(homedir(), ".trae", "extensions"),           // Trae
  path.join(homedir(), ".void", "extensions"),           // Void
  path.join(homedir(), ".vscode", "extensions"),         // VS Code
  path.join(homedir(), ".vscode-insiders", "extensions"), // VS Code Insiders
  path.join(homedir(), ".vscode-oss", "extensions"),    // VSCodium (Linux)
  path.join(homedir(), ".vscodium", "extensions"),       // VSCodium (macOS)
  path.join(homedir(), ".windsurf", "extensions"),       // Windsurf
  path.join(homedir(), ".positron", "extensions"),       // Positron
];

const CACHE_DIR = path.join(GLOBAL_CONFIG_DIR, "vscode-extension");

async function readVersion(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the embedded extension assets to ~/.koincode/vscode-extension/.
 * Skips if the cached version already matches — only writes on first run or version bump.
 */
async function ensureCachedAssets(): Promise<string> {
  const outDir = path.join(CACHE_DIR, "out");
  const existing = await readVersion(CACHE_DIR);
  if (existing === EXTENSION_VERSION) return CACHE_DIR;

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(CACHE_DIR, "package.json"), EXTENSION_PACKAGE_JSON),
    writeFile(path.join(outDir, "extension.js"), EXTENSION_JS),
  ]);

  return CACHE_DIR;
}

/**
 * Installs the cached extension into a single editor's extensions folder.
 * Skips if the current version is already present. Removes stale versions before copying.
 */
async function installInto(
  extensionsDir: string,
  assetDir: string,
): Promise<void> {
  // e.g. ~/.vscode/extensions/koincode-vscode-0.1.0/
  const installDir = path.join(
    extensionsDir,
    `${EXTENSION_NAME}-${EXTENSION_VERSION}`,
  );

  // Already installed at this version — nothing to do
  const installedVersion = await readVersion(installDir);
  if (installedVersion === EXTENSION_VERSION) return;

  // Remove old versions (e.g. koincode-vscode-0.0.9/) before installing new one
  const entries = await readdir(extensionsDir);
  await Promise.all(
    entries
      .filter(
        (e) =>
          e.startsWith(`${EXTENSION_NAME}-`) &&
          e !== path.basename(installDir),
      )
      .map((e) =>
        rm(path.join(extensionsDir, e), { recursive: true, force: true }),
      ),
  );

  // Copy extension files from cache into the editor's extensions folder.
  // Editor picks up the new version on next restart.
  const outDir = path.join(installDir, "out");
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(installDir, "package.json"),
      await readFile(path.join(assetDir, "package.json"), "utf8"),
    ),
    writeFile(
      path.join(outDir, "extension.js"),
      await readFile(path.join(assetDir, "out", "extension.js"), "utf8"),
    ),
  ]);
}

/**
 * Called once at CLI startup. If running inside a VSCode-based editor (TERM_PROGRAM === "vscode"),
 * extracts the embedded extension to ~/.koincode/vscode-extension/, then installs or updates it
 * into every known editor extensions folder present on disk. Runs in the background — never awaited.
 */
export function ensureIdeExtension(): void {
  if (process.env.TERM_PROGRAM !== "vscode") return;

  const targets = KNOWN_EXTENSION_DIRS.filter((d) => fs.existsSync(d));
  if (targets.length === 0) return;

  void ensureCachedAssets().then((assetDir) =>
    Promise.allSettled(targets.map((d) => installInto(d, assetDir))),
  );
}

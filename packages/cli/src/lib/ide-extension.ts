import path from "node:path";
import fs from "node:fs";
import { cp, mkdir, readFile, rm, readdir } from "node:fs/promises";
import { homedir } from "node:os";

const EXTENSION_NAME = "koincode-vscode";

const KNOWN_EXTENSION_DIRS = [
  path.join(homedir(), ".antigravity", "extensions"),   // Antigravity
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

// Prod: vscode-extension/ sits next to the built binary in dist/.
// Dev: resolve back up to the source package.
const RUNTIME_DIR = path.dirname(Bun.main);
const ASSET_DIR_PROD = path.join(RUNTIME_DIR, "vscode-extension");
const ASSET_DIR_DEV = path.join(import.meta.dirname, "../../../vscode-extension");
const ASSET_DIR = fs.existsSync(path.join(ASSET_DIR_PROD, "package.json"))
  ? ASSET_DIR_PROD
  : ASSET_DIR_DEV;

/** Reads the `version` field from `<dir>/package.json`. Returns null if the file is missing or malformed. */
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
 * Installs the bundled extension into a single editor's extensions folder.
 * Skips if the current version is already present. Removes stale versions before copying.
 */
async function installInto(extensionsDir: string): Promise<void> {
  // Reads version from the extension assets shipped inside the CLI (dist/vscode-extension/package.json)
  // If the assets are missing entirely, returns null and we bail out early.
  const bundledVersion = await readVersion(ASSET_DIR);
  if (!bundledVersion) return;

  // This is where the new version WILL live — we haven't created it yet.
  const installDir = path.join(extensionsDir, `${EXTENSION_NAME}-${bundledVersion}`);

  // → null  (the folder doesn't exist yet, so package.json isn't there)
  // If this had returned the current bundled version e.g "0.2.0", the versions match and we'd return early — nothing to do.
  const installedVersion = await readVersion(installDir);
  if (installedVersion === bundledVersion) return;

  // Remove stale versions before installing the new one.
  // Lists everything currently in the extensions folder.
  const entries = await readdir(extensionsDir);

  await Promise.all(
    entries
      .filter((e) => e.startsWith(`${EXTENSION_NAME}-`) && e !== path.basename(installDir))
      .map((e) => rm(path.join(extensionsDir, e), { recursive: true, force: true })),
  );

  // Creates user/.ide/extensions/<new vscode extension to add, e.g koincode-vscode-0.2.0>/

  await mkdir(installDir, { recursive: true });

  // Copies the bundled extension files into that new folder.
  // Editor picks up the new version on next restart.
  await cp(ASSET_DIR, installDir, { recursive: true });
}

/**
 * Called once at CLI startup. If running inside a VSCode-based editor (`TERM_PROGRAM === "vscode"`),
 * finds every known editor extensions folder present on disk and installs or updates the bundled
 * KOINCODE IDE extension into each one. Runs entirely in the background — never awaited.
 */
export function ensureIdeExtension(): void {
  if (process.env.TERM_PROGRAM !== "vscode") return;

  // checks if file exists to add extension else exit
  if (!fs.existsSync(path.join(ASSET_DIR, "package.json"))) return;

  const targets = KNOWN_EXTENSION_DIRS.filter((d) => fs.existsSync(d));
  if (targets.length === 0) return;

  void Promise.allSettled(targets.map((d) => installInto(d)));
}

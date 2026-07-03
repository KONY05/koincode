#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * NPM binary wrapper — the entry point when koincode is installed via npm/yarn/pnpm.
 *
 * IMPORTANT: this script never downloads anything. The download already
 * happened during `npm install`, via optionalDependencies + the os/cpu fields
 * on each platform package (see bin/compile.ts). npm reads koincode's
 * optionalDependencies list (all 5 platform packages), checks each one's
 * os/cpu against the host machine, and silently skips every non-matching one
 * — so only one platform package ever actually lands on disk. This script's
 * only job is to find that one binary and exec it.
 *
 * This file itself is installed as bin/npm-wrapper.cjs inside the `koincode`
 * package, so __dirname at runtime is `.../koincode/bin`. `path.join(__dirname, "..")`
 * climbs back up to the root of the installed koincode package.
 *
 * Resolution order:
 *   1. Nested node_modules: {koincode}/node_modules/@koincode/{platform}/bin/koincode
 *      — where plain npm normally places optional deps (nested under the
 *      depending package rather than hoisted).
 *   2. require.resolve() fallback: bun/pnpm/yarn often hoist deps into a
 *      shared top-level node_modules instead, so the nested path above won't
 *      exist. require.resolve() reuses Node's own module resolution to find
 *      wherever the platform package actually ended up.
 *   3. Error with manual-install instructions — happens if the platform is
 *      unsupported, or the optionalDependency was never installed (e.g. `npm
 *      install --no-optional`).
 *
 * Uses CommonJS require() intentionally, and the .cjs extension is required
 * because packages/cli/package.json sets "type": "module" — without it, Node
 * would parse this file as ESM and require() would throw.
 */

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Maps Node's os.platform()-os.arch() key to the optionalDependency package name
// that ships the matching binary. Must stay in sync with the targets built in
// bin/compile.ts and the packages published from packages/cli/dist/npm.
const PLATFORMS = {
  "darwin-arm64": "@koincode/darwin-arm64",
  "darwin-x64": "@koincode/darwin-x64",
  "linux-x64": "@koincode/linux-x64",
  "linux-arm64": "@koincode/linux-arm64",
  "win32-x64": "@koincode/windows-x64",
};

const key = `${os.platform()}-${os.arch()}`;
const pkg = PLATFORMS[key];
const suffix = os.platform() === "win32" ? ".exe" : "";

let binPath;

if (pkg) {
  // Try nested node_modules first (npm), then require.resolve for hoisting
  // package managers (bun, pnpm, yarn).
  const nested = path.join(
    __dirname,
    "..",
    "node_modules",
    pkg,
    "bin",
    `koincode${suffix}`,
  );
  if (fs.existsSync(nested)) {
    binPath = nested;
  } else {
    // Hoisting package managers may place the platform package elsewhere in
    // the tree, so fall back to Node's own module resolution.
    try {
      const pkgJson = require.resolve(`${pkg}/package.json`);
      const resolved = path.join(path.dirname(pkgJson), "bin", `koincode${suffix}`);
      if (fs.existsSync(resolved)) {
        binPath = resolved;
      }
    } catch {}
  }
}

if (!binPath) {
  // Either the platform isn't in PLATFORMS, or npm didn't install the
  // matching optionalDependency (e.g. --no-optional, or an unsupported combo).
  console.error(`Could not find the koincode binary for ${key}.`);
  if (os.platform() === "win32") {
    console.error(
      "Try installing directly instead: irm https://raw.githubusercontent.com/KONY05/koincode/main/install.ps1 | iex",
    );
  } else {
    console.error(
      "Try installing directly instead: curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh",
    );
  }
  process.exit(1);
} else {
  // binPath already exists on disk (installed in step 1 above) — this just
  // execs it, forwarding CLI args and inheriting stdio so the TUI renders
  // directly in the user's terminal. No download happens here.
  const child = spawn(binPath, process.argv.slice(2), { stdio: "inherit" });

  // Forward termination signals so Ctrl+C etc. reach the actual binary.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }

  // Mirror the child's exit code so shells/scripts see the real result.
  child.on("close", (code) => process.exit(code ?? 1));
}

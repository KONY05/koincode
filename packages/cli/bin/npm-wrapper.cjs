#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * NPM binary wrapper — the entry point when koincode is installed via npm/yarn/pnpm.
 *
 * This script runs on plain Node.js (no Bun required). Its job is to resolve
 * the correct platform-specific native binary from the optionalDependencies
 * and spawn it. The platform packages (e.g. @koincode/darwin-arm64) are installed
 * by npm based on the user's OS/CPU — only the matching one lands on disk.
 *
 * Resolution order:
 *   1. Nested node_modules: node_modules/@koincode/{platform}/bin/koincode (npm)
 *   2. require.resolve() fallback: for hoisting package managers (bun, pnpm, yarn)
 *   3. Error with install instructions (unsupported platform)
 *
 * Uses CommonJS require() intentionally, and the .cjs extension is required
 * because packages/cli/package.json sets "type": "module" — without it, Node
 * would parse this file as ESM and require() would throw.
 */

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

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
  const child = spawn(binPath, process.argv.slice(2), { stdio: "inherit" });

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }

  child.on("close", (code) => process.exit(code ?? 1));
}

#!/usr/bin/env bun

/**
 * Cross-platform compilation script — builds standalone koincode binaries
 * and generates per-platform npm packages for binary distribution.
 *
 * Outputs two things per target:
 *   1. Flat binary at dist/koincode-{os}-{arch} — uploaded to GitHub Releases
 *      for curl/iex installs.
 *   2. npm package directory at dist/npm/koincode-{os}-{arch}/ — each contains
 *      the binary in bin/ and a package.json with os/cpu constraints so npm
 *      only installs the matching platform. These are published as separate npm
 *      packages and pulled in via optionalDependencies from the main koincode package.
 *
 * Flags:
 *   --single    Build only for the current platform (local dev)
 *   --os=NAME   Build only for a specific OS (darwin, linux, windows)
 *   (none)      Build all 5 targets
 */

import { $ } from "bun";
import fs from "fs";
import path from "path";
import pkg from "../package.json";

const dir = path.resolve(import.meta.dirname, "..");
process.chdir(dir);

// ─── Load env ──────────────────────────────────────────────────────────────

const envFile = path.resolve(dir, "../../.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) process.env[match[1]!] = match[2]!;
  }
}

const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN;
if (!MIXPANEL_TOKEN) {
  console.error("ERROR: Missing MIXPANEL_TOKEN. Add it to .env or set as env var.");
  process.exit(1);
}

// ─── Flags ─────────────────────────────────────────────────────────────────

const singleFlag = process.argv.includes("--single");
const osFlag = process.argv.find((a) => a.startsWith("--os="))?.split("=")[1];

// ─── Targets ───────────────────────────────────────────────────────────────

const allTargets: { os: string; arch: "arm64" | "x64" }[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "win32", arch: "x64" },
];

const targets = singleFlag
  ? allTargets.filter((t) => t.os === process.platform && t.arch === process.arch)
  : osFlag
    ? allTargets.filter((t) => t.os === osFlag || (osFlag === "windows" && t.os === "win32"))
    : allTargets;

// ─── Install all platform packages for cross-compilation ───────────────────

const opentuiVersion = pkg.dependencies["@opentui/core"] ?? pkg.devDependencies["@opentui/core"];
if (opentuiVersion) {
  console.log("Installing cross-platform @opentui/core packages...");
  await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiVersion.replace("^", "")}`.quiet();
}

// ─── Resolve parser worker ─────────────────────────────────────────────────

const localWorker = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js");
const rootWorker = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js");
const parserWorker = fs.existsSync(localWorker) ? fs.realpathSync(localWorker) : fs.realpathSync(rootWorker);

// ─── Build each target ─────────────────────────────────────────────────────

const npmDir = path.resolve(dir, "dist/npm");
fs.mkdirSync(npmDir, { recursive: true });

for (const item of targets) {
  const os = item.os === "win32" ? "windows" : item.os;
  const exeSuffix = item.os === "win32" ? ".exe" : "";
  const name = `koincode-${os}-${item.arch}`;
  const binaryName = `${name}${exeSuffix}`;
  console.log(`Building ${name}...`);

  const target = `bun-${os}-${item.arch}` as Bun.Build.CompileTarget;

  const result = await Bun.build({
    entrypoints: ["./bin/koincode.ts", parserWorker],
    external: ["playwright"],
    format: "esm",
    minify: true,
    splitting: true,
    compile: {
      target,
      outfile: `./dist/${binaryName}`,
    },
    define: {
      "process.env.NODE_ENV": "'production'",
      "process.env.MIXPANEL_TOKEN": `'${MIXPANEL_TOKEN}'`,
      OTUI_TREE_SITTER_WORKER_PATH:
        (item.os === "win32" ? '"B:/~BUN/root/' : '"/$bunfs/root/') +
        path.relative(dir, parserWorker).replaceAll("\\", "/") +
        '"',
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  // Generate per-platform npm package directory.
  // Each directory is a standalone publishable npm package containing only the
  // binary and a package.json with os/cpu constraints. Version is stamped from
  // the main package.json so all packages stay in sync.
  const npmPkgName = `@koincode/${os}-${item.arch}`;
  const npmPkgDir = path.join(npmDir, npmPkgName);
  const npmBinDir = path.join(npmPkgDir, "bin");
  fs.mkdirSync(npmBinDir, { recursive: true });

  const srcBinary = path.resolve(dir, `dist/${binaryName}`);
  const destBinary = path.join(npmBinDir, `koincode${exeSuffix}`);
  fs.copyFileSync(srcBinary, destBinary);
  fs.chmodSync(destBinary, 0o755);

  const npmPkgJson = {
    name: npmPkgName,
    version: pkg.version,
    description: `Platform-specific binary for koincode (${item.os}/${item.arch})`,
    os: [item.os],
    cpu: [item.arch],
    preferUnplugged: true,
    license: "MIT",
    repository: {
      type: "git",
      url: "https://github.com/KONY05/koincode.git",
    },
  };
  fs.writeFileSync(
    path.join(npmPkgDir, "package.json"),
    JSON.stringify(npmPkgJson, null, 2) + "\n",
  );

  console.log(`  ✓ ${name}`);
}

console.log("\nStandalone binaries built in dist/");
console.log("npm packages generated in dist/npm/");

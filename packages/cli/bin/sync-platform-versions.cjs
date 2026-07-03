#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * Runs as npm's `version` lifecycle hook (see package.json `scripts.version`).
 * npm has already bumped `version` in package.json by the time this runs, but
 * before it commits — so we rewrite the @koincode/* optionalDependencies pins
 * to match and re-stage the file, keeping them included in npm's version commit.
 *
 * compile.ts stamps every platform package with this same `version` field at
 * build/publish time, so these pins must always match it exactly or npm will
 * silently skip installing the platform binary (see the win32-x64 bug this
 * was added to prevent).
 */

const fs = require("fs");
const path = require("path");
// const { execFileSync } = require("child_process");

const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

for (const name of Object.keys(pkg.optionalDependencies || {})) {
  if (name.startsWith("@koincode/")) {
    pkg.optionalDependencies[name] = pkg.version;
  }
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
// execFileSync("git", ["add", pkgPath]);

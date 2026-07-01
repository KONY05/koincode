# 33 — NPM Binary Distribution

## Summary

Distribute the compiled standalone binaries through npm so `npm i -g koincode` installs a native binary — no Bun, no Node runtime needed at execution time. Users get the same zero-dependency experience as the curl installer, but through the familiar npm install flow.

## Problem

The current npm install requires Bun as a runtime (`curl bun.sh | bash && bun i -g koincode`). The standalone binary from Feature 32 eliminates this, but only via curl/direct download. Most developers already have npm — if `npm i -g koincode` just worked without Bun, it would cover the largest install base with the least friction.

## Approach

Follow the pattern used by esbuild, turbo, and OpenCode: publish platform-specific npm packages containing the compiled binary, with the main package acting as a thin wrapper that resolves and executes the correct one.

### 1. Platform packages

Create one npm package per target, each containing only the compiled binary and a `package.json` with `os`/`cpu` constraints:

| Package | OS | CPU | Binary |
|---|---|---|---|
| `koincode-darwin-arm64` | darwin | arm64 | `koincode-darwin-arm64` |
| `koincode-darwin-x64` | darwin | x64 | `koincode-darwin-x64` |
| `koincode-linux-x64` | linux | x64 | `koincode-linux-x64` |
| `koincode-linux-arm64` | linux | arm64 | `koincode-linux-arm64` |
| `koincode-windows-x64` | win32 | x64 | `koincode-windows-x64.exe` |

Each package's `package.json`:

```json
{
  "name": "koincode-darwin-arm64",
  "version": "1.10.4",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "preferUnplugged": true
}
```

The `os` and `cpu` fields tell npm/bun/pnpm to only install the package on matching platforms. `preferUnplugged` ensures Yarn PnP extracts the binary to disk.

### 2. Main package wrapper

The existing `koincode` package on npm gains:

**`optionalDependencies`** pointing to all platform packages:

```json
{
  "optionalDependencies": {
    "koincode-darwin-arm64": "1.10.4",
    "koincode-darwin-x64": "1.10.4",
    "koincode-linux-x64": "1.10.4",
    "koincode-linux-arm64": "1.10.4",
    "koincode-windows-x64": "1.10.4"
  }
}
```

**`bin`** pointing to a thin wrapper script:

```json
{
  "bin": {
    "koincode": "bin/koincode"
  }
}
```

**Wrapper script** (`bin/koincode`):

```js
#!/usr/bin/env node
const { execFileSync } = require("child_process");
const path = require("path");
const os = require("os");

const PLATFORMS = {
  "darwin-arm64": "koincode-darwin-arm64",
  "darwin-x64": "koincode-darwin-x64",
  "linux-x64": "koincode-linux-x64",
  "linux-arm64": "koincode-linux-arm64",
  "win32-x64": "koincode-windows-x64",
};

const key = `${os.platform()}-${os.arch()}`;
const pkg = PLATFORMS[key];

if (!pkg) {
  console.error(`Unsupported platform: ${key}`);
  process.exit(1);
}

const suffix = os.platform() === "win32" ? ".exe" : "";
const bin = path.join(__dirname, "..", "node_modules", pkg, `bin/koincode${suffix}`);

try {
  execFileSync(bin, process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
```

This runs on Node (no Bun needed) — it just finds and exec's the native binary.

### 3. Build script changes

Update `compile.ts` to generate per-platform npm packages in `dist/`:

```
dist/
  koincode-darwin-arm64/
    bin/koincode              ← compiled binary
    package.json              ← { name, version, os, cpu }
  koincode-darwin-x64/
    bin/koincode
    package.json
  koincode-linux-x64/
    ...
```

### 4. CI publish changes

Update the publish workflow to:

1. Build all platform binaries (already done)
2. Generate per-platform `package.json` files with the current version
3. Publish each platform package: `npm publish` from each `dist/koincode-<platform>/` directory
4. Publish the main `koincode` package with updated `optionalDependencies` versions

All platform packages and the main package must have the same version number.

### 5. Version sync

All packages share a single version from `packages/cli/package.json`. The compile script stamps it into each platform `package.json` at build time. The main package's `optionalDependencies` are also stamped with the same version.

## Install experience

After implementation:

```bash
# Works on any machine with npm — no Bun needed
npm i -g koincode

# Also works with other package managers
bun i -g koincode
pnpm i -g koincode
yarn global add koincode
```

npm detects the platform, downloads only the matching ~80MB binary package, and the wrapper script routes to it. Same zero-dependency binary, familiar install flow.

### 6. Self-update across install methods

The existing update flow (`update-cli.ts`) assumes an npm-managed install — it detects the package manager and runs `npm install -g koincode`. This breaks for users who installed via `curl` (installs to `/usr/local/bin/koincode` or `~/.local/bin/koincode`) or `iex` (installs to `$env:LOCALAPPDATA\koincode\koincode.exe`).

#### Install method detection

Detect how koincode was installed by examining the binary's own path (`process.execPath` or equivalent):

| Path pattern | Install method |
|---|---|
| Contains `node_modules/koincode` | npm/bun/yarn/pnpm |
| Contains `.bun/install` or `.bun/bin` | bun global |
| `/usr/local/bin/koincode` or `~/.local/bin/koincode` | curl (Unix) |
| `$LOCALAPPDATA\koincode\koincode.exe` | iex (Windows) |
| Anything else | Unknown — fall back to npm |

#### Update strategies

**npm-managed installs** — existing flow, unchanged:
1. Detect package manager from binary path
2. Run `<pkg-manager> install -g koincode`

**curl/iex installs** — new self-update flow:
1. Check for new version against npm registry (same `registry.npmjs.org/koincode/latest` check)
2. Resolve download URL: `https://github.com/KONY05/koincode/releases/download/v{version}/koincode-{os}-{arch}`
3. Download new binary to a temp file in the same directory
4. On Unix: `chmod +x` the temp file, rename it over the current binary (atomic on same filesystem)
5. On Windows: rename current binary to `.old`, move new binary into place, delete `.old`
6. On macOS: strip quarantine flag (`xattr -d com.apple.quarantine`)

The download and replace happen in the background. No CLI output — the existing "New version available" banner on the Home screen changes to "Update installed — restart koincode to use v{version}" once the binary has been replaced.

#### Permission handling

- If the binary is in a root-owned directory (`/usr/local/bin`), the self-update will fail silently. The Home screen banner falls back to: `Update available — run: sudo koincode --update`
- For `~/.local/bin` or `$LOCALAPPDATA` installs, no elevation needed — background replace works directly.

#### Version source

Both strategies check the same npm registry endpoint. The GitHub release tag is derived from the version: tag `v1.11.0` → binary asset `koincode-darwin-arm64`. This works because the CI workflow already publishes GitHub releases and npm packages from the same version.

#### Changes to `update-cli.ts`

```ts
function detectInstallMethod(): "npm" | "curl" {
  const binPath = process.execPath;
  if (binPath.includes("node_modules") || binPath.includes(".bun")) {
    return "npm";
  }
  return "curl";
}

export function runUpdate(destroyRenderer: () => void, newVersion: string): void {
  const method = detectInstallMethod();
  if (method === "npm") {
    runNpmUpdate(destroyRenderer, newVersion);  // existing logic
  } else {
    runSelfUpdate(destroyRenderer, newVersion); // new: download + replace
  }
}
```

### 7. Wrapper script signal handling

The Node wrapper script (`bin/koincode`) uses `execFileSync`, which doesn't propagate signals cleanly for an interactive CLI. Replace with `child_process.spawn` and forward signals:

```js
#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

const PLATFORMS = {
  "darwin-arm64": "koincode-darwin-arm64",
  "darwin-x64": "koincode-darwin-x64",
  "linux-x64": "koincode-linux-x64",
  "linux-arm64": "koincode-linux-arm64",
  "win32-x64": "koincode-windows-x64",
};

const key = `${os.platform()}-${os.arch()}`;
const pkg = PLATFORMS[key];

if (!pkg) {
  console.error(`Unsupported platform: ${key}`);
  process.exit(1);
}

const suffix = os.platform() === "win32" ? ".exe" : "";
const bin = path.join(__dirname, "..", "node_modules", pkg, `bin/koincode${suffix}`);

const child = spawn(bin, process.argv.slice(2), {
  stdio: "inherit",
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("close", (code) => process.exit(code ?? 1));
```

## Scope

- Platform npm packages (5 packages): package.json generation in compile.ts
- Main package wrapper: `bin/koincode` Node script with signal forwarding that resolves and exec's the binary
- `optionalDependencies` in main package.json with version stamping
- CI: publish platform packages before main package
- Version sync across all packages
- Self-update for curl/iex installs: download binary from GitHub releases and replace in place
- Install method detection in `update-cli.ts` to route between npm update and self-update

## Out of Scope

- Scoped packages (`@koincode/cli-darwin-arm64`) — requires npm org setup, use flat names for now
- Homebrew tap — separate distribution channel, not npm-related
- Auto-update on launch (checking + installing without user action) — keep explicit update trigger

## Decisions

- **Keep the Bun JS bundle** as a fallback for unsupported platforms. The npm binary packages cover the 5 main targets; any other platform falls back to the existing Bun-based install.
- **`koincode --update` CLI flag** — expose self-update as a CLI flag so curl/iex users can update from the terminal without launching the TUI.

## Open Questions

- Should platform packages be published to a separate npm org (`@koincode/`) if one is created later?

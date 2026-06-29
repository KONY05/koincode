# 32 — Standalone Binary Distribution

## Summary

Replace the current install flow (`npm i -g bun` → `npm i -g koincode`) with a single self-contained binary per platform. Users download one file and run it — no Bun, no Node, no package manager required. Built with `bun build --compile`, distributed via GitHub Releases, and installable with a one-line shell command.

## Problem

Non-technical users report the setup is too complex: install Bun (an unfamiliar runtime), then install the package globally, then configure keys. The first two steps are pure friction — they're infrastructure, not product. Every extra step is a drop-off point.

## Approach

### 1. Compile standalone binaries

`bun build --compile` embeds the Bun runtime into the output binary. The result is a single executable with zero external dependencies.

Target matrix (4 binaries):

| Target | Flag | Output |
|---|---|---|
| macOS ARM (Apple Silicon) | `--target=bun-darwin-arm64` | `koincode-darwin-arm64` |
| macOS Intel | `--target=bun-darwin-x64` | `koincode-darwin-x64` |
| Linux x64 | `--target=bun-linux-x64` | `koincode-linux-x64` |
| Windows x64 | `--target=bun-windows-x64` | `koincode-windows-x64.exe` |

Note: OpenTUI terminal rendering on Windows is not yet validated — the binary will build and run, but visual output may need adjustment.

### 2. Update `bin/build.sh`

Add a `--compile` build path alongside the existing JS bundle. The JS bundle stays for `npm publish`; the compile path produces platform binaries.

```bash
# Standalone binaries (no runtime needed)
for target in bun-darwin-arm64 bun-darwin-x64 bun-linux-x64; do
  suffix="${target#bun-}"
  bun build bin/koincode.ts --compile --target "$target" \
    --outfile "dist/koincode-${suffix}" \
    "${DEFINE_FLAGS[@]}"
done
```

#### External modules caveat

The current build uses `--external` for several packages (`playwright`, `@sentry/bun`, `@opentui/core`, `@opentui/react`, `react`, `react-router`). `--compile` bundles everything into the binary, so `--external` flags must be dropped — all dependencies get embedded. This increases binary size but eliminates the need for `node_modules` at runtime.

- **Playwright** must be excluded from the compiled binary entirely — see "Playwright gating" below.
- **Prisma/libsql** native bindings: `@libsql/client` uses platform-specific `.node` files. Verify these get embedded correctly by the compile step, or bundle the WASM fallback instead.

### 2b. Playwright gating

Browser tools (`browserNavigate`, `browserScreenshot`, `browserClick`, `browserType`, `browserGetConsoleLogs`, `browserClose`, `serverStart`) are opt-in, not bundled by default. This follows the same approach as OpenCode, which gates browser features behind an `OPENCODE_ENABLE_BROWSER` env var.

**Why gate it:**
- Playwright's library adds ~5MB to the binary, but the real cost is the Chromium download (~150MB) required at runtime
- Most users never use browser tools — they chat, edit files, and run commands
- Bundling Playwright pulls in transitive dependencies that complicate `--compile` and inflate binary size
- Keeping it separate means the core binary stays lean (est. 50-80MB vs 80-150MB)

**How it works:**

1. **Config flag:** Add `browserTools: boolean` to `KoincodeGlobalConfig` (default: `false`). Users enable it via:
   - `koincode --enable-browser-tools` (CLI flag, persists to config)
   - Or `/enable-browser-tools` command in the command menu (persists to config)

2. **Conditional tool registration:** The server only includes browser tool definitions in the system prompt and tool contracts when browser tools are enabled. When disabled, the agent doesn't know they exist and won't try to use them.

3. **Browser resolution:** When a user enables browser tools for the first time, resolve a browser in this order (first match wins):

   **a. System Chrome (zero download)**
   - macOS: check `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
   - Linux: check `google-chrome` or `google-chrome-stable` on `$PATH`
   - If found, launch via `playwright-core` with `channel: "chrome"` — no download needed at all
   - This covers the majority of users since most machines have Chrome installed

   **b. Existing Playwright Chromium (zero download)**
   - Check `~/.cache/ms-playwright/` (Playwright's standard location)
   - If present (user has Playwright installed from another project), use it directly

   **c. Download Chromium from CDN (fallback)**
   - If neither Chrome nor existing Chromium is found, prompt: `No browser detected. Download Chromium (~150MB)? (y/n)`
   - On confirm, download from Playwright's CDN (`https://playwright.azureedge.net/builds/chromium/` — platform-specific zips). Plain HTTP download + unzip, no package manager needed.
   - Extract to `~/.cache/ms-playwright/` so `playwright-core` finds it automatically

   Cache the resolved browser path and a `browserReady: true` flag in config so this resolution only happens once.

4. **Direct browser launch:** Bundle `playwright-core` (not `playwright`) into the compiled binary. `playwright-core` is the library without the browser download step — it can launch system Chrome via `channel: "chrome"` or discover Chromium at `~/.cache/ms-playwright/` by default. No custom path configuration needed for either case.

**File changes:**
- `packages/shared/src/schemas.ts` — Export browser tools separately from the base PLAN/BUILD tool sets
- `packages/shared/src/config.ts` — Add `browserTools` to config type
- `packages/server/src/prompts/system-prompt.ts` — Only include browser control section when browser tools are enabled
- `packages/server/src/routes/chat.ts` — Conditionally merge browser tools into tool contracts
- `packages/cli/src/tools/browser/` — Wrap all Playwright usage in dynamic imports
- `packages/cli/src/lib/browser-setup.ts` — New module: check/install Playwright + Chromium on first use

### 3. GitHub Actions release workflow

Create `.github/workflows/release.yml`:

1. Trigger on version tag push (`v*.*.*`)
2. Build all 3 platform binaries on the appropriate runners (macOS for darwin, Ubuntu for linux)
3. Upload binaries as GitHub Release assets
4. Generate release notes from commits since last tag

### 4. Install script

Create `install.sh` hosted at the repo (or a short URL):

```bash
curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh
```

The script:

1. Detects OS (`uname -s`) and architecture (`uname -m`)
2. Maps to the correct binary name (`darwin-arm64`, `darwin-x64`, `linux-x64`)
3. Downloads the latest release binary from GitHub Releases API
4. Places it in `/usr/local/bin/koincode` (or `~/.local/bin` if no sudo)
5. Makes it executable (`chmod +x`)
6. Prints a success message with next steps (`koincode --setup`)

### 5. Update README

Replace the install section:

```
# Install
curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh

# Or download directly from GitHub Releases
# https://github.com/KONY05/koincode/releases/latest
```

Keep the `npm i -g koincode` path documented as an alternative for users who already have Bun/Node.

## Server bundling

The server (`packages/server`) is currently built as a separate JS file (`dist/server.js`) that the CLI spawns as a child process. For the standalone binary, two options:

**Option A: Single binary (recommended)** — Bundle the server code into the same compiled binary. The CLI spawns itself with a `--server` flag instead of running a separate `server.js`. This keeps distribution as one file.

**Option B: Two binaries** — Ship `koincode` and `koincode-server` separately. Simpler build but worse DX (two files to manage).

Option A is preferred. Add a `--server` entry point check at the top of the CLI:

```typescript
if (process.argv.includes("--server")) {
  await import("@koincode/server");
  // server starts, CLI never renders
} else {
  // normal CLI boot
}
```

The server manager then spawns `process.execPath` with `["--server"]` instead of `bun dist/server.js`.

## Scope

- **Build script:** Update `bin/build.sh` with compile targets, exclude Playwright from compiled binary
- **CI:** New GitHub Actions workflow for release builds
- **Install script:** New `install.sh` at repo root (includes `xattr` quarantine removal for macOS)
- **Server bundling:** Embed server into CLI binary with `--server` flag
- **Server manager:** Update spawn command to use `process.execPath --server`
- **Playwright gating:** Config flag + conditional tool registration + lazy install on first use
- **README:** Update install instructions

## Out of Scope

- ~~Windows binary~~ (added — `bun build --compile` now fully supports Windows; OpenTUI validation on Windows is pending but the binary is shipped)
- Homebrew tap (add after validating the binary approach — small maintenance cost, high discoverability)
- Auto-update from binary (the existing `/update` command assumes npm — needs a separate spec for binary self-update)
- Code signing / notarization for macOS (future — unsigned binaries trigger Gatekeeper warnings, install script clears quarantine flag as a workaround)

## Open Questions

- Should the install script support a `--version` flag for pinning, or always install latest?
- Should the Prisma/SQLite migration files be embedded in the binary or extracted on first run?

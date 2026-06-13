# Product Release Plan

## Goals

Ship KOINCODE as a globally installable CLI on npm (`koincode`) with a CI/CD pipeline that typechecks, lints, builds, and auto-publishes on every merge to `main`.

---

## Order of Implementation

### 1. Prep `packages/cli/package.json` ✅
- Set `name: "koincode"` (remove scoped name)
- Remove `"private": true`
- Add `version: "1.0.0"`
- Add `files` whitelist (only ship `dist/` and `bin/`)
- Confirm `bin` entry points to the built output
- Set `main`/`module` to `dist/index.js`

**Blocked:** `bin/koincode` currently imports from `../src/` (source files).
Before publishing, it must be updated to import from `../dist/` so the built package works.
The `.env` path (`../../../.env`) is also repo-relative and must be changed to use a user config dir (e.g. `~/.config/koincode/.env`).

### 2. Verify `koincode` is available on npm
- Check npmjs.com that the package name is unclaimed
- Register/claim it with a first publish if needed

### 3. Set up npm account + `NPM_TOKEN` secret
- Create account at npmjs.com
- Generate an Automation token under Account → Access Tokens
- Add as `NPM_TOKEN` in GitHub repo → Settings → Secrets and Variables → Actions

### 4. GitHub Actions: CI workflow
- Triggers on every PR targeting `main`
- Steps: install → typecheck (`tsc --noEmit`) → lint

### 5. GitHub Actions: publish workflow
- Triggers on merge to `main`
- Steps: install → typecheck → lint → build → `npm publish`

### 6. Versioning convention
- Manual bump strategy: run `npm version patch|minor|major` in `packages/cli` before merging
- Patch = bug fixes, Minor = new features, Major = breaking changes
- CI publishes whatever version is in `package.json`

### 7. First publish
- Run `npm publish --dry-run` to validate the package output
- Then do the real publish to claim the `koincode` name on npm

---

## Notes

- Only `@koincode/cli` is published; server and shared packages remain internal
- Workspace dependencies (`@koincode/shared`) must be bundled into the CLI build before publish
- The server is run locally by the user — it is not deployed

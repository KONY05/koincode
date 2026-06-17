#!/usr/bin/env bash
set -euo pipefail

# Load .env from repo root if present
ENV_FILE="$(dirname "$0")/../../../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

DEFINE_FLAGS=(
  --define "process.env.NODE_ENV='production'"
)

if [ -n "${MIXPANEL_TOKEN:-}" ]; then
  DEFINE_FLAGS+=(--define "process.env.MIXPANEL_TOKEN='$MIXPANEL_TOKEN'")
fi

# CLI
bun build bin/koincode.ts --outdir dist --target bun \
  --external playwright --external @sentry/bun \
  --external @opentui/core --external @opentui/react \
  --external react --external react-router \
  "${DEFINE_FLAGS[@]}" \
  && mv dist/koincode.js dist/koincode

# Server
bun build ../server/src/index.ts --outfile dist/server.js --target bun \
  --external playwright --external @sentry/bun --external @libsql/client \
  --define "process.env.NODE_ENV='production'"

# Migrations
cp -r ../database/prisma/migrations dist/migrations

# VS Code extension
bun build ../vscode-extension/src/extension.ts \
  --outfile dist/vscode-extension/out/extension.js \
  --target node --format cjs --external vscode \
  && cp ../vscode-extension/package.json dist/vscode-extension/package.json

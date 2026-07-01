#!/usr/bin/env bash
set -euo pipefail

# Dev-only build script — used for local development, not for npm publishing.
# npm publishing uses the compiled standalone binary via compile.ts.

# Load .env from repo root if present
ENV_FILE="$(dirname "$0")/../../../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

REQUIRED_VARS=(MIXPANEL_TOKEN)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Missing required environment variables: ${MISSING[*]}" >&2
  echo "Add them to .env (local) or GitHub Actions secrets (CI)." >&2
  exit 1
fi

DEFINE_FLAGS=(
  --define "process.env.NODE_ENV='production'"
  --define "process.env.MIXPANEL_TOKEN='$MIXPANEL_TOKEN'"
)

# ─── CLI bundle (dev / local testing only) ─────────────────────────────────

bun build bin/koincode.ts --outdir dist --target bun \
  --external playwright --external @sentry/bun \
  --external @opentui/core --external @opentui/react \
  --external react --external react-router \
  "${DEFINE_FLAGS[@]}" \
  && mv dist/koincode.js dist/koincode

# ─── Server bundle (needed alongside CLI bundle for dev mode) ───────────────

bun build ../server/src/index.ts --outfile dist/server.js --target bun \
  --external playwright --external @sentry/bun --external @libsql/client \
  --define "process.env.NODE_ENV='production'"

#!/usr/bin/env sh
set -e

# KOINCODE installer — downloads the latest release binary for your platform.
# Usage: curl -fsSL https://raw.githubusercontent.com/KONY05/koincode/main/install.sh | sh

REPO="KONY05/koincode"
INSTALL_DIR="/usr/local/bin"
FALLBACK_DIR="$HOME/.local/bin"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)
    echo "Error: Unsupported operating system: $OS" >&2
    echo "KOINCODE supports macOS and Linux." >&2
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH" >&2
    echo "KOINCODE supports arm64 and x64." >&2
    exit 1
    ;;
esac

# Linux arm64 not yet supported
if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
  echo "Error: Linux arm64 binaries are not yet available." >&2
  echo "Please use x64 or install via npm: npm i -g koincode" >&2
  exit 1
fi

BINARY_NAME="koincode-${os}-${arch}"

# Get latest release tag
echo "Finding latest release..."
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
  echo "Error: Could not determine the latest release." >&2
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${BINARY_NAME}"

echo "Downloading koincode ${LATEST_TAG} for ${os}-${arch}..."

# Download to temp file
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

if ! curl -fSL --progress-bar -o "$TMPFILE" "$DOWNLOAD_URL"; then
  echo "Error: Download failed. Check that a release exists for ${os}-${arch}." >&2
  exit 1
fi

chmod +x "$TMPFILE"

# Install — prefer /usr/local/bin, fall back to ~/.local/bin
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "$INSTALL_DIR/koincode"
  echo "Installed to $INSTALL_DIR/koincode"
elif command -v sudo >/dev/null 2>&1; then
  echo "Installing to $INSTALL_DIR (requires sudo)..."
  sudo mv "$TMPFILE" "$INSTALL_DIR/koincode"
  echo "Installed to $INSTALL_DIR/koincode"
else
  mkdir -p "$FALLBACK_DIR"
  mv "$TMPFILE" "$FALLBACK_DIR/koincode"
  echo "Installed to $FALLBACK_DIR/koincode"
  case ":$PATH:" in
    *":$FALLBACK_DIR:"*) ;;
    *) echo "Add $FALLBACK_DIR to your PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
fi

# macOS: remove quarantine flag so Gatekeeper doesn't block unsigned binary
if [ "$os" = "darwin" ]; then
  xattr -d com.apple.quarantine "$(command -v koincode 2>/dev/null || echo "$INSTALL_DIR/koincode")" 2>/dev/null || true
fi

echo ""

# Colored ASCII wordmark — matches the "tiny" ascii-font used in the TUI header
# (packages/cli/src/components/header.tsx), so the install splash and the app's
# own splash screen read as the same brand.
if [ -t 1 ]; then
  WHITE='\033[97m'
  ORANGE='\033[38;5;208m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  WHITE=''; ORANGE=''; DIM=''; RESET=''
fi

echo ""
printf "%b\n" "${WHITE}█▄▀ █▀█ █ █▄ █ ${ORANGE}█▀▀ █▀█ █▀▄ █▀▀ ${RESET}"
printf "%b\n" "${WHITE}█ █ █▄█ █ █ ▀█ ${ORANGE}█▄▄ █▄█ █▄▀ ██▄ ${RESET}"
echo ""
printf "%b\n" "${DIM}koincode ${LATEST_TAG} installed successfully!${RESET}"
echo ""
echo "Koincode gives access to free/frontier models, get started:"
echo "  cd <project-folder>        # open your project folder/directory"
echo "  koincode --setup           # Configure your API keys"
echo "  koincode                   # Start coding"
echo ""
echo "For more information visit https://github.com/${REPO}"

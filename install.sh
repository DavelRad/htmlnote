#!/usr/bin/env bash
# htmlnote installer — downloads a precompiled binary from GitHub Releases.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DavelRad/htmlnote/main/install.sh | bash
#   bash install.sh [--version vX.Y.Z]
#   bash install.sh --local <path>      # install from local checkout (clone+build)
#
# Env:
#   HTMLNOTE_REPO       override repo (default: DavelRad/htmlnote)
#   HTMLNOTE_BIN_DIR    override install location (default: ~/.local/bin)
#   HTMLNOTE_VERSION    override version (default: latest)

set -euo pipefail

REPO="${HTMLNOTE_REPO:-DavelRad/htmlnote}"
BIN_DIR="${HTMLNOTE_BIN_DIR:-$HOME/.local/bin}"
VERSION="${HTMLNOTE_VERSION:-latest}"
LOCAL_SRC=""

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      [ -z "$VERSION" ] && { echo "--version requires a value" >&2; exit 1; }
      shift 2
      ;;
    --local)
      LOCAL_SRC="${2:-}"
      [ -z "$LOCAL_SRC" ] && { echo "--local requires a path" >&2; exit 1; }
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: install.sh [--version vX.Y.Z] [--local <path>]

  --version vX.Y.Z   install a specific release (default: latest)
  --local <path>     install from a local checkout (npm build + symlink)

Env:
  HTMLNOTE_REPO      override repo (default: DavelRad/htmlnote)
  HTMLNOTE_BIN_DIR   override install location (default: ~/.local/bin)
  HTMLNOTE_VERSION   override version
USAGE
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

say() { printf '\033[1;33m[htmlnote]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[htmlnote]\033[0m %s\n' "$*" >&2; exit 1; }

# ─── Local-checkout path: keep the npm-build flow available for devs ──────
if [ -n "$LOCAL_SRC" ]; then
  command -v node >/dev/null || die "node is required (>= 18)"
  command -v npm  >/dev/null || die "npm is required"
  NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  [ "$NODE_MAJOR" -ge 18 ] || die "node >= 18 required (got $(node -v))"
  say "installing from local checkout: $LOCAL_SRC"
  ( cd "$LOCAL_SRC" && npm install --silent && npm run build --silent )
  mkdir -p "$BIN_DIR"
  ln -sf "$LOCAL_SRC/bin/htmlnote.mjs" "$BIN_DIR/htmlnote"
  chmod +x "$LOCAL_SRC/bin/htmlnote.mjs"
  say "linked $BIN_DIR/htmlnote → $LOCAL_SRC/bin/htmlnote.mjs"
  exit 0
fi

# ─── Binary path: download from GitHub Releases ───────────────────────────
detect_target() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) die "unsupported OS: $(uname -s) — install with --local <path> instead" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) die "unsupported arch: $(uname -m) — install with --local <path> instead" ;;
  esac
  echo "${os}-${arch}"
}

command -v curl >/dev/null || die "curl is required"

TARGET="$(detect_target)"
say "platform: $TARGET"

if [ "$VERSION" = "latest" ]; then
  # Resolve latest tag without auth (public repo)
  RESOLVED=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
             | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')
  [ -n "$RESOLVED" ] || die "couldn't resolve latest release tag for ${REPO}"
  VERSION="$RESOLVED"
fi
say "version: $VERSION"

BIN_URL="https://github.com/${REPO}/releases/download/${VERSION}/htmlnote-${TARGET}"
SUM_URL="${BIN_URL}.sha256"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "downloading binary"
curl -fsSL -o "$TMP/htmlnote" "$BIN_URL" || die "couldn't download binary: $BIN_URL"
curl -fsSL -o "$TMP/htmlnote.sha256" "$SUM_URL" || die "couldn't download checksum: $SUM_URL"

# Verify SHA256 — refuses to install on mismatch.
expected=$(cut -d' ' -f1 < "$TMP/htmlnote.sha256")
if [ "$(uname -s)" = "Darwin" ]; then
  actual=$(shasum -a 256 "$TMP/htmlnote" | cut -d' ' -f1)
else
  actual=$(sha256sum "$TMP/htmlnote" | cut -d' ' -f1)
fi
[ "$expected" = "$actual" ] || die "checksum mismatch — refusing to install (expected $expected, got $actual)"
say "checksum verified"

mkdir -p "$BIN_DIR"
mv "$TMP/htmlnote" "$BIN_DIR/htmlnote"
chmod +x "$BIN_DIR/htmlnote"
say "installed → $BIN_DIR/htmlnote"

if ! command -v htmlnote >/dev/null 2>&1; then
  say "warning: $BIN_DIR is not in your PATH"
  printf '\n  add to your shell rc:\n    export PATH="%s:$PATH"\n\n' "$BIN_DIR"
fi

cat <<EOF

  htmlnote $VERSION installed.

  Next: register it with Claude Code (one time, from inside Claude).
  Run each line as a separate prompt — don't paste both at once:

      /plugin marketplace add https://github.com/${REPO}.git
      /plugin install htmlnote

  After that, every time Claude writes or edits an .html file, htmlnote
  pops in your browser. Mark it up, hit Done, and Claude reads the
  feedback as additional context for its next turn.

EOF

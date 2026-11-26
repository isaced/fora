#!/bin/sh
# Install fora's standalone binary from GitHub Releases.

set -eu

REPO="isaced/fora"
VERSION="${FORA_VERSION:-}"
INSTALL_DIR="${FORA_INSTALL_DIR:-$HOME/.fora/bin}"
MODIFY_PATH="${FORA_MODIFY_PATH:-0}"
BIN="fora"

usage() {
  cat <<EOF
Install the fora CLI from GitHub Releases.

Usage: sh install.sh [OPTIONS]

Options:
  --no-modify-path   Do not append \$INSTALL_DIR to the shell profile
  --modify-path      Append \$INSTALL_DIR to \$HOME/.profile
  -h, --help         Show this help

Environment:
  FORA_VERSION       Install a specific tag, e.g. fora-cli-v0.3.0
  FORA_INSTALL_DIR   Install directory (default: \$HOME/.fora/bin)
  FORA_MODIFY_PATH   Set to 1 to append to \$HOME/.profile
  FORA_VERIFY_ATTESTATION  Set to 1 to require 'gh attestation verify'
EOF
}

for arg in "$@"; do
  case "$arg" in
    --no-modify-path) MODIFY_PATH=0 ;;
    --modify-path) MODIFY_PATH=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v curl >/dev/null 2>&1 || {
  echo "error: curl is required" >&2
  exit 1
}

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin)
    case "$arch" in
      arm64) asset="fora-darwin-arm64" ;;
      x86_64) asset="fora-darwin-x64" ;;
      *) echo "error: unsupported macOS architecture: $arch" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    libc="gnu"
    if [ -f /etc/alpine-release ]; then libc="musl"; fi
    case "$arch" in
      x86_64)
        if [ "$libc" = "musl" ]; then asset="fora-linux-x64-musl"; else asset="fora-linux-x64"; fi
        ;;
      aarch64 | arm64)
        if [ "$libc" = "musl" ]; then asset="fora-linux-arm64-musl"; else asset="fora-linux-arm64"; fi
        ;;
      *) echo "error: unsupported Linux architecture: $arch" >&2; exit 1 ;;
    esac
    ;;
  MINGW* | MSYS* | CYGWIN*)
    asset="fora-windows-x64.exe"
    BIN="fora.exe"
    ;;
  *)
    echo "error: unsupported operating system: $os" >&2
    exit 1
    ;;
esac

if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$VERSION" ] || {
    echo "error: could not determine the latest release" >&2
    exit 1
  }
fi

base_url="https://github.com/$REPO/releases/download/$VERSION"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

echo "Downloading $asset ($VERSION)"
curl -fsSL -o "$tmp_dir/$asset" "$base_url/$asset"
curl -fsSL -o "$tmp_dir/$asset.sha256" "$base_url/$asset.sha256"

(
  cd "$tmp_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$asset.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$asset.sha256"
  else
    echo "error: sha256sum or shasum is required to verify the download" >&2
    exit 1
  fi
)

if [ "${FORA_VERIFY_ATTESTATION:-0}" = "1" ]; then
  command -v gh >/dev/null 2>&1 || {
    echo "error: FORA_VERIFY_ATTESTATION=1 requires gh" >&2
    exit 1
  }
  gh attestation verify "$tmp_dir/$asset" -R "$REPO"
  echo "Build attestation verified"
fi

mkdir -p "$INSTALL_DIR"
tmp_bin="$INSTALL_DIR/.fora-install-tmp"
cp "$tmp_dir/$asset" "$tmp_bin"
chmod 755 "$tmp_bin"
mv -f "$tmp_bin" "$INSTALL_DIR/$BIN"

echo "Installed $INSTALL_DIR/$BIN"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    if [ "$MODIFY_PATH" = "1" ]; then
      profile="${SHELL_PROFILE:-$HOME/.profile}"
      printf '\n# fora\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >>"$profile"
      echo "Added $INSTALL_DIR to PATH in $profile"
    else
      echo "Add this directory to PATH:"
      echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    fi
    ;;
esac

echo "Verify with: $INSTALL_DIR/$BIN --version"

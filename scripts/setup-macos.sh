#!/usr/bin/env bash
set -euo pipefail

INSTALL=0
if [[ "${1:-}" == "--install" ]]; then
  INSTALL=1
fi

fail=0
check() {
  local name="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    echo "Missing: $name"
    fail=1
  fi
}

check "Xcode Command Line Tools" xcode-select -p
check "Node.js 20+" node --version
check "npm" npm --version
check "Rust" cargo --version

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This build targets Apple Silicon (arm64); current machine is $(uname -m)." >&2
  exit 1
fi

if [[ "$fail" -ne 0 ]]; then
  if [[ "$INSTALL" -ne 1 ]]; then
    cat <<'EOF'

Install the missing tools:
  xcode-select --install
  brew install node              # if Homebrew is available
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

Re-run with: bash scripts/setup-macos.sh --install
EOF
    exit 1
  fi

  if ! xcode-select -p >/dev/null 2>&1; then
    echo "Opening the Xcode Command Line Tools installer..."
    xcode-select --install || true
    echo "Finish the installer, then re-run this script."
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      brew install node
    else
      echo "Homebrew is not installed. Install Node.js 20+ manually, then re-run." >&2
      exit 1
    fi
  fi

  if ! command -v cargo >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
fi

cat <<'EOF'

macOS build prerequisites are ready.
Next:
  npm ci
  npm run build:app

Artifacts are written to release-assets/v<version>/platforms/macos/.
Signing is done separately on the Linux workstation.
EOF

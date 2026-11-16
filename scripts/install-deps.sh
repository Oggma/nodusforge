#!/usr/bin/env bash
# Install NodusForge's Linux build prerequisites. Run once per machine.
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script targets Debian/Ubuntu-based systems (Linux Mint included)." >&2
  exit 1
fi

# rustup installs into ~/.cargo; make it visible in this shell if present.
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "==> Installing Tauri build dependencies (sudo required)"
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  pkg-config \
  curl \
  file \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev

if ! command -v cargo >/dev/null 2>&1; then
  echo "==> Installing Rust (rustup, minimal profile)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
else
  echo "==> Rust already installed: $(cargo --version)"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node 20.19+ (nvm or NodeSource) and re-run." >&2
  exit 1
fi

# Make the rustup PATH available in future login shells.
PROFILE="$HOME/.profile"
if [ -f "$HOME/.cargo/env" ] && ! grep -q 'cargo/env' "$PROFILE" 2>/dev/null; then
  {
    echo ""
    echo "# >>> NodusForge: Rust toolchain >>>"
    echo 'if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi'
    echo "# <<< NodusForge: Rust toolchain <<<"
  } >> "$PROFILE"
  echo "==> Added ~/.cargo/bin to PATH in ~/.profile"
fi

echo "==> Done. Next (from the NodusForge repo root):"
echo "    npm ci"
echo "    npm run desktop        # loads ~/.cargo/env, then runs tauri dev"
echo "    # or: source \"\$HOME/.cargo/env\" && npm run tauri dev"
echo "    npm run build:app      # build the unsigned Linux .deb"

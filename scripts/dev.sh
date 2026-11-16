#!/usr/bin/env bash
# Start NodusForge in development mode from any directory.
# Handles the rustup PATH and checks the Tauri build dependencies.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo was not found." >&2
  echo "Run: source \"\$HOME/.cargo/env\"  (or bash scripts/install-deps.sh)" >&2
  exit 1
fi

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "pkg-config is missing. Run: bash scripts/install-deps.sh" >&2
  exit 1
fi

missing=0
for package in gtk+-3.0 webkit2gtk-4.1 ayatana-appindicator3-0.1; do
  if ! pkg-config --exists "$package"; then
    echo "Missing build dependency: $package" >&2
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Run: bash scripts/install-deps.sh" >&2
  exit 1
fi

exec npm run tauri dev

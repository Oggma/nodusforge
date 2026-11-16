#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/myapp.key"
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ] && [ -f "$HOME/.tauri/signing.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.tauri/signing.env"
fi

export TAURI_SIGNING_PRIVATE_KEY
if [ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

if [ ! -f "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo "Signing key not found: $TAURI_SIGNING_PRIVATE_KEY" >&2
  echo "Set TAURI_SIGNING_PRIVATE_KEY to the private key path." >&2
  exit 1
fi

echo "Using signing key: $TAURI_SIGNING_PRIVATE_KEY"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  echo "No TAURI_SIGNING_PRIVATE_KEY_PASSWORD set. If the key is encrypted, set it or create ~/.tauri/signing.env." >&2
fi

npm run typecheck
npm run build
(
  cd src-tauri
  cargo check
)

npm run tauri build -- --bundles deb

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
DEB="$PWD/src-tauri/target/release/bundle/deb/NodusForge_${VERSION}_amd64.deb"
SIG="${DEB}.sig"

if [ ! -s "$DEB" ]; then
  echo "Missing bundle: $DEB" >&2
  exit 1
fi

if [ ! -s "$SIG" ]; then
  echo "Missing signature: $SIG" >&2
  echo "The build was not signed. Check TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD." >&2
  exit 1
fi

echo
echo "Signed .deb: $DEB"
echo "Signature:   $SIG"
echo
echo "Next: create release-assets/v${VERSION}/RELEASE_NOTES.md, then run:"
echo "  node scripts/make-latest-json.mjs"

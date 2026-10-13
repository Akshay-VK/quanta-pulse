#!/usr/bin/env bash
# Build a compressed DMG from the Tauri .app bundle using only hdiutil.
#
# Tauri's own DMG bundler (bundle_dmg.sh) drives Finder via AppleScript to lay
# out the window, which fails in non-interactive/headless sessions. This script
# produces an equivalent, reproducible disk image without a GUI session.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/Quanta Pulse.app"
OUT_DIR="$ROOT/src-tauri/target/release/bundle/dmg"

if [ ! -d "$APP" ]; then
  echo "app bundle not found: $APP" >&2
  echo "run 'npx tauri build --bundles app' first" >&2
  exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "$APP/Contents/Info.plist" 2>/dev/null || echo 0.0.0)"

case "$(uname -m)" in
  arm64) ARCH_LABEL="aarch64" ;;
  x86_64) ARCH_LABEL="x64" ;;
  *) ARCH_LABEL="$(uname -m)" ;;
esac

OUT="$OUT_DIR/Quanta Pulse_${VERSION}_${ARCH_LABEL}.dmg"
mkdir -p "$OUT_DIR"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$OUT"
hdiutil create -volname "Quanta Pulse" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
echo "created $OUT"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/minitool-dist"
OUT_DIR="$ROOT/dist"
ZIP="$OUT_DIR/emojpack-xhs.zip"

rm -rf "$DIST"
rm -f "$ZIP"
mkdir -p "$DIST" "$OUT_DIR"

cp -R "$ROOT/app/." "$DIST/"
cp "$ROOT/xhs/bridge.js" "$DIST/assets/share.js"

find "$DIST" -name '.DS_Store' -delete

(cd "$DIST" && zip -qr "$ZIP" . -x '*.DS_Store')

echo "built: $ZIP"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE_NAME="clickup-hierarchy-helper"
VERSION="$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")"
ZIP_PATH="$DIST_DIR/$PACKAGE_NAME-$VERSION.zip"

cd "$ROOT_DIR"

node --check content.js
node --check popup.js
node --check tests/run-fixtures.mjs
node --check tests/release-audit.mjs
python3 -m json.tool manifest.json >/dev/null
node tests/run-fixtures.mjs
node tests/release-audit.mjs

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

zip -r "$ZIP_PATH" \
  manifest.json \
  content.js \
  content.css \
  popup.html \
  popup.js \
  icons \
  README.md \
  PRIVACY.md \
  STORE_LISTING.md \
  -x "*.DS_Store"

echo "$ZIP_PATH"

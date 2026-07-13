#!/usr/bin/env bash
# Build the Chrome Web Store zip: the MV3 extension with the Capture/Media
# features and their permissions stripped (see tools/build-store-package.mjs),
# manifest.json at the archive root — ready to upload to the developer
# dashboard.
#
# Usage: tools/build-store-zip.sh [output-dir]
# Output: <output-dir>/pageside-<version>-store.zip   (default output-dir: dist/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/domain-css-injector-v2"
OUTDIR="${1:-$ROOT/dist}"
mkdir -p "$OUTDIR"
OUTDIR="$(cd "$OUTDIR" && pwd)"
VERSION="$(node -e "console.log(require('$SRC/manifest.json').version)")"
OUT="$OUTDIR/pageside-${VERSION}-store.zip"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

node "$ROOT/tools/build-store-package.mjs" "$STAGE"

rm -f "$OUT"
( cd "$STAGE" && zip -r "$OUT" . -x "*.DS_Store" "Thumbs.db" >/dev/null )

# The Web Store requires manifest.json at the zip root.
if ! unzip -l "$OUT" | grep -qE ' manifest\.json$'; then
  echo "ERROR: manifest.json is not at the zip root." >&2
  exit 1
fi
echo "Built $OUT (Web Store build, manifest.json at root)."

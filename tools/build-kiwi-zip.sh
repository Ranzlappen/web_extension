#!/usr/bin/env bash
# Build a Kiwi / Android (Manifest V2) zip of the extension, with manifest.json
# at the archive root — ready to load in Kiwi via kiwi://extensions.
#
# Usage: tools/build-kiwi-zip.sh [output-dir]
# Output: <output-dir>/pageside-<version>-kiwi.zip   (default output-dir: dist/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/domain-css-injector-v2"
OUTDIR="${1:-$ROOT/dist}"
VERSION="$(node -e "console.log(require('$SRC/manifest.json').version)")"
OUT="$OUTDIR/pageside-${VERSION}-kiwi.zip"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Copy every shipped file EXCEPT the MV3 manifest, then drop in the MV2 manifest.
cp -r "$SRC"/. "$STAGE"/
rm -f "$STAGE/manifest.json"
node "$ROOT/tools/build-kiwi-manifest.mjs" "$SRC/manifest.json" > "$STAGE/manifest.json"

mkdir -p "$OUTDIR"
rm -f "$OUT"
( cd "$STAGE" && zip -r "$OUT" . -x "*.DS_Store" "Thumbs.db" >/dev/null )

# manifest.json MUST be at the zip root or Kiwi silently rejects the archive.
if ! unzip -l "$OUT" | grep -qE ' manifest\.json$'; then
  echo "ERROR: manifest.json is not at the zip root." >&2
  exit 1
fi
echo "Built $OUT (Manifest V2, manifest.json at root)."

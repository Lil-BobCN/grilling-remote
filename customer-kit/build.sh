#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

name="grilling-skills-v1"
out="dist/$name"

rm -rf "$out" "dist/$name.zip" "dist/$name.zip.sha256"
mkdir -p dist
cp -R package "$out"
find "$out" -name '.DS_Store' -delete

(cd dist && zip -qr "$name.zip" "$name" && shasum -a 256 "$name.zip" > "$name.zip.sha256")

echo "built: $(pwd)/dist/$name.zip"
cat "dist/$name.zip.sha256"

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

version=$(jq -r '.version' manifest.json)
built_on=$(jq -r '.date' manifest.json)
name="客户工作区-$version"

mkdir -p dist
rm -f "dist/$name.zip" "dist/$name.zip.sha256"

# 从 manifest.json 生成包内技能清单
jq -r --arg v "$version" --arg d "$built_on" '
  "# 技能清单\n\n工作区版本：\($v)（\($d)）\n\n| 技能 | 一句话 | 什么时候用 |\n| --- | --- | --- |",
  (.skills[] | "| `\(.name)` | \(.summary) | \(.when) |")
' manifest.json > package/技能清单.md

(cd package && zip -qr "../dist/$name.zip" . -x '*.DS_Store')
(cd dist && shasum -a 256 "$name.zip" > "$name.zip.sha256")

echo "built: $(pwd)/dist/$name.zip"
cat "dist/$name.zip.sha256"

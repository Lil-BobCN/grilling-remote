#!/usr/bin/env bash
# 在开发机上打发布包。只打包，不传服务器。
#
#   bash deploy/backend/package.sh <源目录> <版本号> [输出文件]
#
# 例：bash deploy/backend/package.sh deploy/backend/placeholder 0.1.0
# 输出默认放 output/afkapp-<版本号>.tgz，output/ 不进仓库。

set -euo pipefail

SRC=${1:?用法：package.sh <源目录> <版本号> [输出文件]}
VERSION=${2:?用法：package.sh <源目录> <版本号> [输出文件]}
OUT=${3:-output/afkapp-$VERSION.tgz}

[[ -d $SRC ]] || { echo "源目录不存在：$SRC" >&2; exit 1; }
[[ $VERSION =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo "版本号只能用字母、数字、点、下划线和连字符" >&2; exit 1; }

mkdir -p "$(dirname -- "$OUT")"
# macOS 的 tar 会把扩展属性写成 96 个 ._ 文件塞进包里，服务器解包后模板里
# 会多出 ._index.test.mjs，客户仓的 node --check 一读就报语法错。
# COPYFILE_DISABLE 从源头拦住，--exclude 再兜一层。
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='._*' --exclude='*/._*' \
  -C "$SRC" -czf "$OUT" .

if command -v sha256sum >/dev/null 2>&1; then
  sum=$(sha256sum "$OUT" | awk '{print $1}')
else
  sum=$(shasum -a 256 "$OUT" | awk '{print $1}')
fi

echo "发布包：$OUT"
echo "大小：$(du -h "$OUT" | awk '{print $1}')"
echo "SHA256：$sum"
